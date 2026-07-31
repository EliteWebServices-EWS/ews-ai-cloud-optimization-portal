import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { RepositoryNotFoundError } from '../../database';
import { createDefaultExecutionAdapterRegistry, createExecutionOrchestrator } from '../../execution';
import type { ExecutionOrchestrator } from '../../execution/execution-orchestrator';
import { ExecutionApiService } from '../../services/execution-api-service';
import { AppError } from '../../shared/utils';
import type { SisumRole } from '../../auth';
import type { CreateExecutionPlanBody } from '../../api/execution-api-validation';
import { createInMemoryExecutionStores, TENANT_A, TENANT_B } from './execution/fixtures';

function actor() {
  return {
    tenantId: TENANT_A,
    actorId: 'actor-rollback',
    actor: {
      authenticated: true,
      userId: 'actor-rollback',
      email: 'actor-rollback@example.com',
      roles: ['admin'] as SisumRole[],
    },
    requestId: 'req-rollback',
    correlationId: 'corr-rollback',
  };
}

function createBody(): CreateExecutionPlanBody {
  return {
    workflowId: 'wf-rollback',
    recommendationId: 'rec-rollback',
    approvalRequired: false,
    riskLevel: 'LOW',
    executionSteps: [
      {
        stepId: 'step-1',
        order: 0,
        actionType: 'START_INSTANCE',
        resourceType: 'EC2',
        resourceId: 'i-rb',
        description: 'start',
      },
    ],
    rollbackPlan: { strategy: 'REVERSE', steps: [], automatic: true },
  };
}

function ec2Factory() {
  let started = false;
  return () => ({
    ec2: {
      send: async (command: { constructor: { name: string } }) => {
        if (command.constructor.name === 'DescribeInstancesCommand') {
          return {
            Reservations: [
              {
                Instances: [
                  {
                    InstanceId: 'i-rb',
                    State: { Name: started ? 'running' : 'stopped' },
                    Tags: [],
                  },
                ],
              },
            ],
          };
        }
        if (command.constructor.name === 'StartInstancesCommand') {
          started = true;
          return {};
        }
        if (command.constructor.name === 'StopInstancesCommand') {
          started = false;
          return {};
        }
        return {};
      },
    } as never,
  });
}

describe('Execution API rollback contract', () => {
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

  async function executedPlan(service: ExecutionApiService, stores: ReturnType<typeof createInMemoryExecutionStores>) {
    const created = await service.createPlan(actor(), createBody());
    const approved = await stores.plans.transitionStatus(
      TENANT_A,
      created.executionId,
      'APPROVED',
      { expectedVersion: created.version },
    );
    const outcome = await service.executePlan(
      actor(),
      approved.executionId,
      approved.version,
    );
    const plan = await stores.plans.getById(TENANT_A, outcome.plan.executionId);
    assert.ok(plan);
    return {
      planId: plan.executionId,
      version: plan.version,
      runId: outcome.result.runId,
    };
  }

  function createService(stores = createInMemoryExecutionStores(), orchestratorOverride?: ExecutionOrchestrator) {
    const base = createExecutionOrchestrator({
      registry: createDefaultExecutionAdapterRegistry(ec2Factory()),
      runs: stores.runs,
    });
    const orchestrator = orchestratorOverride ?? base;
    return new ExecutionApiService({
      plans: stores.plans,
      runs: stores.runs,
      history: stores.history,
      orchestrator,
    });
  }

  async function rolledBackHistoryCount(
    stores: ReturnType<typeof createInMemoryExecutionStores>,
    executionId: string,
  ) {
    const page = await stores.history.listByExecution(TENANT_A, executionId, {});
    return page.items.filter(
      (item) => item.eventType === 'STATUS_CHANGED' && item.nextStatus === 'ROLLED_BACK',
    ).length;
  }

  it('succeeds on first eligible rollback', async () => {
    const stores = createInMemoryExecutionStores();
    const service = createService(stores);
    const executed = await executedPlan(service, stores);
    const outcome = await service.rollbackPlan(
      actor(),
      executed.planId,
      executed.version,
    );
    assert.equal(outcome.result.status, 'ROLLED_BACK');
    assert.equal(outcome.plan.planStatus, 'ROLLED_BACK');
    assert.equal(outcome.rollbackRequested, true);
    assert.equal(await rolledBackHistoryCount(stores, executed.planId), 1);
  });

  it('returns 409 on duplicate rollback without invoking orchestrator again', async () => {
    const stores = createInMemoryExecutionStores();
    let rollbackCalls = 0;
    const base = createExecutionOrchestrator({
      registry: createDefaultExecutionAdapterRegistry(ec2Factory()),
      runs: stores.runs,
    });
    const orchestrator = {
      run: base.run.bind(base),
      rollbackRun: async (...args: Parameters<ExecutionOrchestrator['rollbackRun']>) => {
        rollbackCalls += 1;
        return base.rollbackRun(...args);
      },
    } as ExecutionOrchestrator;
    const service = createService(stores, orchestrator);
    const executed = await executedPlan(service, stores);
    await service.rollbackPlan(actor(), executed.planId, executed.version);
    assert.equal(rollbackCalls, 1);

    const plan = await stores.plans.getById(TENANT_A, executed.planId);
    assert.ok(plan);
    await assert.rejects(
      () => service.rollbackPlan(actor(), executed.planId, plan.version),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 409 &&
        error.message.includes('already rolled back'),
    );
    assert.equal(rollbackCalls, 1);
    assert.equal(await rolledBackHistoryCount(stores, executed.planId), 1);
  });

  it('allows only one concurrent rollback start', async () => {
    const stores = createInMemoryExecutionStores();
    let rollbackCalls = 0;
    const base = createExecutionOrchestrator({
      registry: createDefaultExecutionAdapterRegistry(ec2Factory()),
      runs: stores.runs,
    });
    const orchestrator = {
      run: base.run.bind(base),
      rollbackRun: async (...args: Parameters<ExecutionOrchestrator['rollbackRun']>) => {
        rollbackCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return base.rollbackRun(...args);
      },
    } as ExecutionOrchestrator;
    const service = createService(stores, orchestrator);
    const executed = await executedPlan(service, stores);
    const results = await Promise.allSettled([
      service.rollbackPlan(actor(), executed.planId, executed.version),
      service.rollbackPlan(actor(), executed.planId, executed.version),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rollbackCalls, 1);
  });

  it('returns EXECUTION_ROLLBACK_FAILED when orchestrator reports rollback failure', async () => {
    const stores = createInMemoryExecutionStores();
    const base = createExecutionOrchestrator({
      registry: createDefaultExecutionAdapterRegistry(ec2Factory()),
      runs: stores.runs,
    });
    const orchestrator = {
      run: base.run.bind(base),
      rollbackRun: async (
        ctx: Parameters<ExecutionOrchestrator['rollbackRun']>[0],
        runId: string,
      ) => {
        const run = await stores.runs.getById(ctx.tenantId, runId);
        assert.ok(run);
        await stores.runs.update(
          ctx.tenantId,
          runId,
          {
            status: 'ROLLBACK_FAILED',
            rollbackFailure: {
              code: 'ROLLBACK_FAILED',
              message: 'Orchestrator rollback failure.',
              stage: 'rollback',
            },
          },
          { expectedVersion: run.version },
        );
        return {
          runId,
          mode: ctx.mode,
          status: 'ROLLBACK_FAILED' as const,
          tenantId: ctx.tenantId,
          rollbackFailure: {
            code: 'ROLLBACK_FAILED',
            message: 'Orchestrator rollback failure.',
            stage: 'rollback',
          },
        };
      },
    } as ExecutionOrchestrator;
    const service = createService(stores, orchestrator);
    const executed = await executedPlan(service, stores);

    await assert.rejects(
      () => service.rollbackPlan(actor(), executed.planId, executed.version),
      (error: unknown) =>
        error instanceof AppError && error.code === 'EXECUTION_ROLLBACK_FAILED',
    );

    const plan = await stores.plans.getById(TENANT_A, executed.planId);
    assert.ok(plan);
    assert.equal(plan.planStatus, 'COMPLETED');
  });

  it('allows retry after ROLLBACK_FAILED while plan remains completed', async () => {
    const stores = createInMemoryExecutionStores();
    const service = createService(stores);
    const executed = await executedPlan(service, stores);

    const failedRun = await stores.runs.getById(TENANT_A, executed.runId);
    assert.ok(failedRun);
    await stores.runs.update(
      TENANT_A,
      executed.runId,
      {
        status: 'ROLLBACK_FAILED',
        rollbackFailure: {
          code: 'ROLLBACK_FAILED',
          message: 'Simulated rollback failure.',
          stage: 'rollback',
        },
      },
      { expectedVersion: failedRun.version },
    );

    const afterFailure = await stores.plans.getById(TENANT_A, executed.planId);
    assert.ok(afterFailure);
    assert.equal(afterFailure.planStatus, 'COMPLETED');

    const retry = await service.rollbackPlan(
      actor(),
      executed.planId,
      afterFailure.version,
    );
    assert.equal(retry.plan.planStatus, 'ROLLED_BACK');
    assert.equal(retry.result.status, 'ROLLED_BACK');
  });

  it('returns safe 404 for cross-tenant duplicate rollback', async () => {
    const stores = createInMemoryExecutionStores();
    const service = createService(stores);
    const executed = await executedPlan(service, stores);
    await service.rollbackPlan(actor(), executed.planId, executed.version);

    await assert.rejects(
      () =>
        service.rollbackPlan(
          {
            ...actor(),
            tenantId: TENANT_B,
          },
          executed.planId,
          executed.version,
        ),
      RepositoryNotFoundError,
    );
  });
});
