import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXECUTION_MODES } from '../../execution/adapters/types';

import {
  buildOrchestratorContext,
  createTestOrchestrator,
  TENANT_A,
} from '../integration/execution/fixtures';

describe('Execution rollback integrity security', () => {
  it('persists previous configuration snapshot before mutation', async () => {
    const ec2 = {
      send: async (command: { constructor: { name: string } }) => {
        if (command.constructor.name === 'DescribeInstancesCommand') {
          return {
            Reservations: [
              {
                Instances: [
                  {
                    InstanceId: 'i-int',
                    State: { Name: 'running' },
                    Tags: [{ Key: 'env', Value: 'prod' }],
                  },
                ],
              },
            ],
          };
        }
        if (command.constructor.name === 'StopInstancesCommand') {
          return {};
        }
        return {};
      },
    };

    const { orchestrator, runs } = createTestOrchestrator(() => ({
      ec2: ec2 as never,
    }));

    const result = await orchestrator.run(buildOrchestratorContext(), {
      service: 'ec2',
      action: 'STOP_INSTANCE',
      resourceId: 'i-int',
    });

    const persisted = await runs.getById(TENANT_A, result.runId);
    assert.ok(persisted?.previousConfiguration);
    assert.equal(persisted?.previousConfiguration?.state, 'running');
  });

  it('does not accept client-provided rollback state in orchestrator API', async () => {
    const { orchestrator, runs } = createTestOrchestrator(() => ({}));
    const result = await orchestrator.run(
      buildOrchestratorContext({ mode: EXECUTION_MODES.VALIDATION }),
      {
        service: 'ec2',
        action: 'START_INSTANCE',
        resourceId: 'i-1',
        parameters: { rollbackState: { forged: true } },
      },
    );

    assert.notEqual(result.status, 'SUCCEEDED');
    assert.equal(await runs.getById(TENANT_A, result.runId), undefined);
  });
});
