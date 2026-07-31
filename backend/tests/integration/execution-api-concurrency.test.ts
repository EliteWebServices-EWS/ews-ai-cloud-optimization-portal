import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createDefaultExecutionAdapterRegistry, createExecutionOrchestrator } from '../../execution';
import { ExecutionApiService } from '../../services/execution-api-service';
import { AppError } from '../../shared/utils';
import { createInMemoryExecutionStores, TENANT_A } from './execution/fixtures';
import type { SisumRole } from '../../auth';
import type { CreateExecutionPlanBody } from '../../api/execution-api-validation';
import {
  analystIdentity,
  createExecutionHttpApp,
  createHttpContext,
  createPlanViaHttp,
  httpJson,
  privilegedIdentity,
  seedTenantOwner,
  submitForApproval,
  withHttpServer,
} from './execution-api/http-fixtures';

function actor() {
  return {
    tenantId: TENANT_A,
    actorId: 'actor-concurrency',
    actor: {
      authenticated: true,
      userId: 'actor-concurrency',
      email: 'actor-concurrency@example.com',
      roles: ['admin'] as SisumRole[],
    },
    requestId: 'req-concurrency',
    correlationId: 'corr-concurrency',
  };
}

function createBody(overrides: Partial<CreateExecutionPlanBody> = {}): CreateExecutionPlanBody {
  return {
    workflowId: 'wf-concurrency',
    recommendationId: 'rec-concurrency',
    approvalRequired: true,
    riskLevel: 'LOW',
    executionSteps: [
      {
        stepId: 'step-1',
        order: 0,
        actionType: 'START_INSTANCE',
        resourceType: 'EC2',
        resourceId: 'i-conc',
        description: 'start',
      },
    ],
    rollbackPlan: { strategy: 'REVERSE', steps: [], automatic: true },
    ...overrides,
  };
}

describe('Execution API concurrency', () => {
  const previousProductionFlag = process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED;
  const previousProviderMode = process.env.PROVIDER_MODE;

  before(() => {
    process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED = 'true';
    process.env.PROVIDER_MODE = 'aws';
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
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
    delete process.env.AUDIT_PERSISTENCE_ENABLED;
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
                      { InstanceId: 'i-conc', State: { Name: 'running' }, Tags: [] },
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

  async function pendingPlan(service: ExecutionApiService) {
    const created = await service.createPlan(actor(), createBody());
    return service.updatePlan(actor(), created.executionId, {
      expectedVersion: created.version,
      submitForApproval: true,
    });
  }

  it('allows only one concurrent approve against the same version', async () => {
    const service = createService();
    const pending = await pendingPlan(service);
    const results = await Promise.allSettled([
      service.approvePlan(actor(), pending.executionId, pending.version),
      service.approvePlan(actor(), pending.executionId, pending.version),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
  });

  it('allows only one concurrent execute against the same version', async () => {
    const service = createService();
    const pending = await pendingPlan(service);
    const approved = await service.approvePlan(actor(), pending.executionId, pending.version);
    const results = await Promise.allSettled([
      service.executePlan(actor(), approved.executionId, approved.version),
      service.executePlan(actor(), approved.executionId, approved.version),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
  });

  it('returns 409 for stale expectedVersion over HTTP on approve', async () => {
    const ctx = createHttpContext();
    await seedTenantOwner(ctx);
    const app = createExecutionHttpApp(ctx);

    await withHttpServer(app, async (baseUrl) => {
      const { planId, version } = await createPlanViaHttp(baseUrl, analystIdentity());
      const pending = await submitForApproval(baseUrl, analystIdentity(), planId, version);
      const first = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/execution/plans/${planId}/approve`,
        privilegedIdentity('owner-a'),
        { expectedVersion: pending.version },
      );
      assert.equal(first.status, 200);
      const stale = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/execution/plans/${planId}/approve`,
        privilegedIdentity('owner-a'),
        { expectedVersion: pending.version },
      );
      assert.equal(stale.status, 409);
    });
  });

  it('leaves plan APPROVED when production execution is disabled mid-request', async () => {
    process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED = 'false';
    const stores = createInMemoryExecutionStores();
    const service = createService(stores);
    const pending = await pendingPlan(service);
    const approved = await service.approvePlan(actor(), pending.executionId, pending.version);

    await assert.rejects(
      () => service.executePlan(actor(), approved.executionId, approved.version),
      (error: unknown) =>
        error instanceof AppError && error.code === 'EXECUTION_PRODUCTION_DISABLED',
    );

    const reloaded = await stores.plans.getById(TENANT_A, approved.executionId);
    assert.ok(reloaded);
    assert.equal(reloaded.planStatus, 'APPROVED');
    process.env.EXECUTION_ADAPTER_PRODUCTION_ENABLED = 'true';
  });

  it('rejects approval from DRAFT at the service layer', async () => {
    const service = createService();
    const created = await service.createPlan(actor(), createBody());
    await assert.rejects(
      () => service.approvePlan(actor(), created.executionId, created.version),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 409 &&
        error.message.includes('PENDING_APPROVAL'),
    );
  });
});
