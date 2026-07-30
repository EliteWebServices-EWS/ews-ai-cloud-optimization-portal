import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InvalidExecutionTransitionError } from '../../services/execution-lifecycle';
import { EXECUTION_MODES, ExecutionAdapterError } from '../../execution/adapters/types';

import {
  buildOrchestratorContext,
  buildPlanInput,
  createInMemoryExecutionStores,
  createTestOrchestrator,
  TENANT_A,
} from './execution/fixtures';

describe('Execution lifecycle integration', () => {
  it('supports plan lifecycle DRAFT -> APPROVED -> EXECUTING -> COMPLETED', async () => {
    const { plans } = createInMemoryExecutionStores();
    const created = await plans.create(buildPlanInput({ executionId: 'exec-life-1' }));

    const approved = await plans.transitionStatus(
      TENANT_A,
      created.executionId,
      'APPROVED',
      { expectedVersion: created.version },
    );

    const executing = await plans.transitionStatus(
      TENANT_A,
      approved.executionId,
      'EXECUTING',
      { expectedVersion: approved.version },
    );

    const completed = await plans.transitionStatus(
      TENANT_A,
      executing.executionId,
      'COMPLETED',
      { expectedVersion: executing.version },
    );

    assert.equal(completed.planStatus, 'COMPLETED');
  });

  it('rejects invalid plan transitions', async () => {
    const { plans } = createInMemoryExecutionStores();
    const created = await plans.create(buildPlanInput({ executionId: 'exec-invalid' }));

    await assert.rejects(
      () =>
        plans.transitionStatus(
          TENANT_A,
          created.executionId,
          'COMPLETED',
          { expectedVersion: created.version },
        ),
      InvalidExecutionTransitionError,
    );
  });

  it('orchestrator rejects unsupported actions before adapter validation', async () => {
    const { orchestrator } = createTestOrchestrator();
    await assert.rejects(
      () =>
        orchestrator.run(
          buildOrchestratorContext({ mode: EXECUTION_MODES.VALIDATION }),
          {
            service: 'ec2',
            action: 'TERMINATE_INSTANCE',
            resourceId: 'i-1',
          },
        ),
      ExecutionAdapterError,
    );
  });

  it('orchestrator dry-run produces plan without run persistence', async () => {
    const ec2 = {
      send: async () => ({
        Reservations: [{ Instances: [{ InstanceId: 'i-1', State: { Name: 'stopped' }, Tags: [] }] }],
      }),
    };

    const { orchestrator, runs } = createTestOrchestrator(() => ({
      ec2: ec2 as never,
    }));

    const result = await orchestrator.run(
      buildOrchestratorContext({ mode: EXECUTION_MODES.DRY_RUN }),
      { service: 'ec2', action: 'START_INSTANCE', resourceId: 'i-1' },
    );

    assert.equal(result.status, 'PLANNED');
    assert.ok(result.dryRunPlan);
    assert.equal(await runs.getById(TENANT_A, result.runId), undefined);
  });

  it('rejects unknown adapter service', () => {
    const { orchestrator } = createTestOrchestrator();
    assert.rejects(
      () =>
        orchestrator.run(buildOrchestratorContext(), {
          service: 'unknown' as 'ec2',
          action: 'START_INSTANCE',
          resourceId: 'i-1',
        }),
      ExecutionAdapterError,
    );
  });
});
