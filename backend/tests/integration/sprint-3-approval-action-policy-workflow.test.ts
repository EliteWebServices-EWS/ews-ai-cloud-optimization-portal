import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

import { ActionLogEmitter } from '../../action-log/action-log-emitter';
import { createDefaultExecutionAdapterRegistry, createExecutionOrchestrator } from '../../execution';
import { RepositoryConflictError, RepositoryNotFoundError } from '../../database';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { ActionLogService } from '../../services/action-log-service';
import { ExecutionApiService } from '../../services/execution-api-service';
import { AppError } from '../../shared/utils';
import { createInMemoryExecutionStores, TENANT_A, TENANT_B } from './execution/fixtures';
import {
  buildProductionPolicyContext,
  buildSimulationPolicyContext,
  buildNotReadyReadinessInput,
} from '../fixtures/action-policy/policy-fixtures';
import type { CreateExecutionPlanBody } from '../../api/execution-api-validation';
import type { SisumRole } from '../../auth';

function actor(tenantId = TENANT_A) {
  return {
    tenantId,
    actorId: 'approver-1',
    actor: {
      authenticated: true,
      userId: 'approver-1',
      email: 'approver-1@example.com',
      roles: ['admin'] as SisumRole[],
    },
    requestId: 'req-policy-1',
    correlationId: 'corr-policy-1',
  };
}

function createBody(overrides: Partial<CreateExecutionPlanBody> = {}): CreateExecutionPlanBody {
  return {
    workflowId: 'wf-policy',
    recommendationId: 'rec-policy',
    approvalRequired: false,
    riskLevel: 'LOW',
    executionSteps: [
      {
        stepId: 'step-1',
        order: 0,
        actionType: 'START_INSTANCE',
        resourceType: 'EC2',
        resourceId: 'i-policy',
        description: 'start',
      },
    ],
    rollbackPlan: { strategy: 'REVERSE', steps: [], automatic: true },
    ...overrides,
  };
}

describe('Sprint 3 approval action policy workflow', () => {
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
                      { InstanceId: 'i-policy', State: { Name: 'running' }, Tags: [] },
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
    const actionLogRepository = new MockActionLogRepository();
    const actionLogEmitter = new ActionLogEmitter(new ActionLogService(actionLogRepository));

    return {
      service: new ExecutionApiService({
        plans: stores.plans,
        runs: stores.runs,
        history: stores.history,
        orchestrator,
        actionLogEmitter,
      }),
      actionLogService: new ActionLogService(actionLogRepository),
    };
  }

  async function listActionLogEvents(
    actionLogService: ActionLogService,
    eventType: string,
  ) {
    const lifecycle = await actionLogService.reconstructCorrelationLifecycle(
      TENANT_A,
      'corr-policy-1',
    );
    return lifecycle.items.filter((event) => event.eventType === eventType);
  }

  it('blocks plan creation when readiness is NOT_READY', async () => {
    const { service } = createService();

    await assert.rejects(
      () =>
        service.createPlan(
          actor(),
          createBody({
            policyContext: buildProductionPolicyContext({
              decisionReadiness: buildNotReadyReadinessInput(),
            }),
          }),
        ),
      (error: unknown) =>
        error instanceof AppError && error.code === 'ACTION_POLICY_BLOCKED',
    );
  });

  it('derives approvalRequired from policy and records ActionLog approval lifecycle', async () => {
    const { service, actionLogService } = createService();
    const created = await service.createPlan(
      actor(),
      createBody({
        policyContext: buildProductionPolicyContext(),
      }),
    );

    assert.equal(created.approvalRequired, true);
    assert.equal(created.approvalStatus, 'PENDING');

    const pending = await service.updatePlan(actor(), created.executionId, {
      expectedVersion: created.version,
      submitForApproval: true,
    });
    assert.equal(pending.planStatus, 'PENDING_APPROVAL');

    const approvalEvents = await listActionLogEvents(actionLogService, 'APPROVAL_REQUIRED');
    assert.equal(approvalEvents.length, 1);

    const approved = await service.approvePlan(
      actor(),
      pending.executionId,
      pending.version,
    );
    assert.equal(approved.approvalStatus, 'APPROVED');

    const grantedEvents = await listActionLogEvents(actionLogService, 'APPROVAL_GRANTED');
    assert.equal(grantedEvents.length, 1);
    assert.equal(grantedEvents[0]?.actorId, 'approver-1');
    assert.equal(grantedEvents[0]?.actorType, 'human');
  });

  it('rejects production execution before approval and after rejection', async () => {
    const { service } = createService();
    const created = await service.createPlan(
      actor(),
      createBody({ policyContext: buildProductionPolicyContext() }),
    );
    const pending = await service.updatePlan(actor(), created.executionId, {
      expectedVersion: created.version,
      submitForApproval: true,
    });

    await assert.rejects(
      () => service.executePlan(actor(), pending.executionId, pending.version),
      (error: unknown) => error instanceof AppError && error.code === 'CONFLICT',
    );

    const rejected = await service.rejectPlan(
      actor(),
      pending.executionId,
      pending.version,
      'policy test rejection',
    );

    await assert.rejects(
      () => service.executePlan(actor(), rejected.executionId, rejected.version),
      (error: unknown) =>
        error instanceof AppError && error.code === 'CONFLICT',
    );
  });

  it('allows approved production execution and emits EXECUTION_STARTED', async () => {
    const { service, actionLogService } = createService();
    const created = await service.createPlan(
      actor(),
      createBody({ policyContext: buildProductionPolicyContext() }),
    );
    const pending = await service.updatePlan(actor(), created.executionId, {
      expectedVersion: created.version,
      submitForApproval: true,
    });
    const approved = await service.approvePlan(
      actor(),
      pending.executionId,
      pending.version,
    );

    await service.executePlan(actor(), approved.executionId, approved.version);

    const startedEvents = await listActionLogEvents(actionLogService, 'EXECUTION_STARTED');
    assert.equal(startedEvents.length, 1);
  });

  it('simulation plan executes via DRY_RUN and emits EXECUTION_SIMULATED', async () => {
    const { service, actionLogService } = createService();
    const created = await service.createPlan(
      actor(),
      createBody({ policyContext: buildSimulationPolicyContext() }),
    );

    assert.equal(created.approvalRequired, false);

    await service.simulatePlan(actor(), created.executionId, created.version);

    const simulatedEvents = await listActionLogEvents(actionLogService, 'EXECUTION_SIMULATED');
    assert.equal(simulatedEvents.length, 1);
  });

  it('DUPLICATE_APPROVAL_IDEMPOTENT rejects second approval attempt', async () => {
    const { service } = createService();
    const created = await service.createPlan(
      actor(),
      createBody({ policyContext: buildProductionPolicyContext() }),
    );
    const pending = await service.updatePlan(actor(), created.executionId, {
      expectedVersion: created.version,
      submitForApproval: true,
    });
    const approved = await service.approvePlan(
      actor(),
      pending.executionId,
      pending.version,
    );

    await assert.rejects(
      () => service.approvePlan(actor(), approved.executionId, approved.version),
      (error: unknown) => error instanceof AppError && error.code === 'CONFLICT',
    );
  });

  it('STALE_PLAN_VERSION_REJECTED on approval', async () => {
    const { service } = createService();
    const created = await service.createPlan(
      actor(),
      createBody({ policyContext: buildProductionPolicyContext() }),
    );
    const pending = await service.updatePlan(actor(), created.executionId, {
      expectedVersion: created.version,
      submitForApproval: true,
    });

    await assert.rejects(
      () => service.approvePlan(actor(), pending.executionId, 1),
      RepositoryConflictError,
    );
  });
});

describe('Sprint 3 approval action policy tenant isolation', () => {
  it('CROSS_TENANT_APPROVAL_DENIED', async () => {
    const stores = createInMemoryExecutionStores();
    const orchestrator = createExecutionOrchestrator({
      registry: createDefaultExecutionAdapterRegistry(() => ({}) as never),
      runs: stores.runs,
    });
    const service = new ExecutionApiService({
      plans: stores.plans,
      runs: stores.runs,
      history: stores.history,
      orchestrator,
    });

    const created = await service.createPlan(
      actor(TENANT_A),
      createBody({ policyContext: buildProductionPolicyContext() }),
    );
    const pending = await service.updatePlan(actor(TENANT_A), created.executionId, {
      expectedVersion: created.version,
      submitForApproval: true,
    });

    await assert.rejects(
      () => service.approvePlan(actor(TENANT_B), pending.executionId, pending.version),
      RepositoryNotFoundError,
    );
  });
});
