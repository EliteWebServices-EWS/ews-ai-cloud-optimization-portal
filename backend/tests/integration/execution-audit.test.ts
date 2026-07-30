import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AUDIT_EVENTS } from '../../audit';
import { EXECUTION_MODES } from '../../execution/adapters/types';

import {
  buildOrchestratorContext,
  createTestOrchestrator,
} from './execution/fixtures';

describe('Execution audit integration', () => {
  it('defines adapter execution and rollback audit event names', () => {
    assert.equal(AUDIT_EVENTS.EXECUTION_STARTED, 'execution.started');
    assert.equal(AUDIT_EVENTS.EXECUTION_SUCCEEDED, 'execution.succeeded');
    assert.equal(AUDIT_EVENTS.EXECUTION_FAILED, 'execution.failed');
    assert.equal(AUDIT_EVENTS.ROLLBACK_STARTED, 'rollback.started');
    assert.equal(AUDIT_EVENTS.ROLLBACK_COMPLETED, 'rollback.completed');
    assert.equal(AUDIT_EVENTS.ROLLBACK_FAILED, 'rollback.failed');
  });

  it('successful production run reaches terminal success state for audit correlation', async () => {
    const ec2 = {
      send: async (command: { constructor: { name: string } }) => {
        if (command.constructor.name === 'DescribeInstancesCommand') {
          return {
            Reservations: [
              {
                Instances: [
                  { InstanceId: 'i-audit', State: { Name: 'running' }, Tags: [] },
                ],
              },
            ],
          };
        }
        if (command.constructor.name === 'StartInstancesCommand') {
          return {};
        }
        return {};
      },
    };

    const { orchestrator } = createTestOrchestrator(() => ({
      ec2: ec2 as never,
    }));

    const result = await orchestrator.run(buildOrchestratorContext(), {
      service: 'ec2',
      action: 'START_INSTANCE',
      resourceId: 'i-audit',
    });

    assert.equal(result.status, 'SUCCEEDED');
  });

  it('simulation modes do not emit production execution persistence', async () => {
    const { orchestrator, runs } = createTestOrchestrator(() => ({}));
    const result = await orchestrator.run(
      buildOrchestratorContext({ mode: EXECUTION_MODES.VALIDATION }),
      { service: 's3', action: 'PUT_BUCKET_TAGGING', resourceId: 'b', parameters: { tags: { a: 'b' } } },
    );

    assert.notEqual(result.status, 'SUCCEEDED');
    assert.equal(await runs.getById(result.tenantId, result.runId), undefined);
  });
});
