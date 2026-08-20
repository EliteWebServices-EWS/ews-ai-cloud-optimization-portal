import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

import { AUDIT_EVENTS } from '../../audit';
import { createDefaultExecutionAdapterRegistry, createExecutionOrchestrator } from '../../execution';
import { InvalidPaginationTokenError, RepositoryConflictError } from '../../database';
import { ExecutionApiService } from '../../services/execution-api-service';
import { AppError } from '../../shared/utils';
import { createInMemoryExecutionStores, TENANT_A, TENANT_B } from './execution/fixtures';
import type { SisumRole } from '../../auth';
import type { CreateExecutionPlanBody } from '../../api/execution-api-validation';
import { buildExecutionApiPolicyContext } from '../fixtures/action-policy/policy-fixtures';

function actor() {
  return {
    tenantId: TENANT_A,
    actorId: 'actor-api',
    actor: {
      authenticated: true,
      userId: 'actor-api',
      email: 'actor-api@example.com',
      roles: ['admin'] as SisumRole[],
    },
    requestId: 'req-1',
    correlationId: 'corr-1',
  };
}

function createBody(overrides: Partial<CreateExecutionPlanBody> = {}): CreateExecutionPlanBody {
  return {
    workflowId: 'wf-service',
    recommendationId: 'rec-service',
    approvalRequired: true,
    riskLevel: 'LOW',
    executionSteps: [
      {
        stepId: 'step-1',
        order: 0,
        actionType: 'START_INSTANCE',
        resourceType: 'EC2',
        resourceId: 'i-svc',
        description: 'start',
      },
    ],
    rollbackPlan: { strategy: 'REVERSE', steps: [], automatic: true },
    policyContext: buildExecutionApiPolicyContext(),
    ...overrides,
  };
}

describe('Execution API service', () => {
  const previousProductionFlag = process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED;
  const previousProviderMode = process.env.PROVIDER_MODE;

  before(() => {
    process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED = 'true';
    process.env.PROVIDER_MODE = 'aws';
  });

  after(() => {
    if (previousProductionFlag === undefined) {
      delete process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED;
    } else {
      process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED = previousProductionFlag;
    }
    if (previousProviderMode === undefined) {
      delete process.env.PROVIDER_MODE;
    } else {
      process.env.PROVIDER_MODE = previousProviderMode;
    }
  });

  function createService(stores = createInMemoryExecutionStores()) {
    const orchestrator = createExecutionOrchestrator({
      registry: createDefaultExecutionAdapterRegistry(() => ({
        ec2: {
          send: async (command: { constructor: { name: string } }) => {
            if (command.constructor.name === 'DescribeInstancesCommand') {
              return {
                Reservations: [
                  {
                    Instances: [
                      { InstanceId: 'i-svc', State: { Name: 'running' }, Tags: [] },
                    ],
                  },
                ],
              };
            }
            return {};
          },
        } as never,
      })),
      runs: stores.runs,
    });

    return new ExecutionApiService({
      plans: stores.plans,
      runs: stores.runs,
      history: stores.history,
      orchestrator,
    });
  }

  it('creates and retrieves plans', async () => {
    const service = createService();
    const created = await service.createPlan(actor(), createBody());
    const loaded = await service.getPlan(TENANT_A, created.executionId);
    assert.ok(loaded);
  });

  it('approves and executes approved plans', async () => {
    const service = createService();
    const created = await service.createPlan(actor(), createBody());
    const pending = await service.updatePlan(actor(), created.executionId, {
      expectedVersion: created.version,
      submitForApproval: true,
    });
    const approved = await service.approvePlan(
      actor(),
      pending.executionId,
      pending.version,
    );
    const outcome = await service.executePlan(
      actor(),
      approved.executionId,
      approved.version,
    );
    assert.equal(outcome.result.status, 'SUCCEEDED');
  });

  it('requires pending approval before approve decision', async () => {
    const service = createService();
    const created = await service.createPlan(actor(), createBody());
    await assert.rejects(
      () => service.approvePlan(actor(), created.executionId, created.version),
      (error: unknown) =>
        error instanceof AppError && error.statusCode === 409,
    );
  });

  it('blocks execution for unapproved plans', async () => {
    const service = createService();
    const created = await service.createPlan(actor(), createBody());
    await assert.rejects(
      () => service.executePlan(actor(), created.executionId, created.version),
      (error: unknown) =>
        error instanceof Error && error.message.includes('APPROVED'),
    );
  });

  it('lists plans with status filter and pagination tokens', async () => {
    const stores = createInMemoryExecutionStores();
    const service = createService(stores);
    await service.createPlan(actor(), createBody({ approvalRequired: false }));
    const page = await service.listPlans(TENANT_A, { status: 'DRAFT', limit: 1 });
    assert.equal(page.items.length, 1);
    if (page.nextToken) {
      await assert.rejects(
        () =>
          stores.plans.listByStatus(TENANT_B, 'DRAFT', {
            nextToken: page.nextToken,
          }),
        InvalidPaginationTokenError,
      );
    }
  });

  it('rejects plans and blocks execution afterward', async () => {
    const service = createService();
    const created = await service.createPlan(actor(), createBody());
    const pending = await service.updatePlan(actor(), created.executionId, {
      expectedVersion: created.version,
      submitForApproval: true,
    });
    const rejected = await service.rejectPlan(
      actor(),
      pending.executionId,
      pending.version,
      'not now',
    );
    assert.equal(rejected.planStatus, 'REJECTED');
    await assert.rejects(
      () => service.executePlan(actor(), rejected.executionId, rejected.version),
    );
  });

  it('fails closed when production execution is disabled without leaving EXECUTING', async () => {
    process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED = 'false';
    const stores = createInMemoryExecutionStores();
    const service = createService(stores);
    const created = await service.createPlan(
      actor(),
      createBody({
        approvalRequired: false,
        policyContext: buildExecutionApiPolicyContext({ infrastructureChanging: false }),
      }),
    );
    const approved = await stores.plans.transitionStatus(
      TENANT_A,
      created.executionId,
      'APPROVED',
      { expectedVersion: created.version },
    );

    await assert.rejects(
      () => service.executePlan(actor(), created.executionId, approved.version),
      (error: unknown) =>
        error instanceof AppError && error.code === 'EXECUTION_PRODUCTION_DISABLED',
    );

    const reloaded = await stores.plans.getById(TENANT_A, created.executionId);
    assert.ok(reloaded);
    assert.equal(reloaded.planStatus, 'APPROVED');
    assert.equal((await stores.runs.listByTenant(TENANT_A, {})).items.length, 0);

    process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED = 'true';
  });

  it('returns conflict on stale plan update version', async () => {
    const service = createService();
    const created = await service.createPlan(actor(), createBody());
    await service.updatePlan(actor(), created.executionId, {
      expectedVersion: created.version,
      metadata: { pass: 1 },
    });
    await assert.rejects(
      () =>
        service.updatePlan(actor(), created.executionId, {
          expectedVersion: created.version,
          metadata: { pass: 2 },
        }),
      RepositoryConflictError,
    );
  });

  it('exposes audit event constants for API routes', () => {
    assert.equal(AUDIT_EVENTS.EXECUTION_PLAN_CREATED, 'execution.plan.created');
    assert.equal(AUDIT_EVENTS.EXECUTION_APPROVED, 'execution.approved');
    assert.equal(AUDIT_EVENTS.EXECUTION_EXECUTED, 'execution.executed');
  });
});
