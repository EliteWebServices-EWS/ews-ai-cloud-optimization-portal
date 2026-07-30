import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXECUTION_MODES } from '../../execution/adapters/types';

import {
  buildOrchestratorContext,
  createTestOrchestrator,
  TENANT_A,
} from './execution/fixtures';

describe('Execution simulation / dry-run integration', () => {
  it('validation mode performs checks without persisting runs', async () => {
    const ec2 = {
      send: async () => ({
        Reservations: [
          { Instances: [{ InstanceId: 'i-sim', State: { Name: 'stopped' }, Tags: [] }] },
        ],
      }),
    };

    const { orchestrator, runs } = createTestOrchestrator(() => ({
      ec2: ec2 as never,
    }));

    const result = await orchestrator.run(
      buildOrchestratorContext({ mode: EXECUTION_MODES.VALIDATION }),
      { service: 'ec2', action: 'START_INSTANCE', resourceId: 'i-sim' },
    );

    assert.equal(result.status, 'VALIDATED');
    assert.ok(result.validation?.valid);
    assert.equal(await runs.getById(TENANT_A, result.runId), undefined);
  });

  it('dry-run returns deterministic plan steps', async () => {
    const { orchestrator } = createTestOrchestrator(() => ({
      lambda: {
        send: async () => ({ MemorySize: 128, Timeout: 3 }),
      } as never,
    }));

    const result = await orchestrator.run(
      buildOrchestratorContext({ mode: EXECUTION_MODES.DRY_RUN }),
      {
        service: 'lambda',
        action: 'UPDATE_FUNCTION_CONFIGURATION',
        resourceId: 'fn-1',
        parameters: { memorySize: 256 },
      },
    );

    assert.equal(result.status, 'PLANNED');
    assert.ok(result.dryRunPlan);
    assert.ok(result.dryRunPlan!.steps.length > 0);
    assert.equal(result.dryRunPlan!.reversible, true);
  });
});
