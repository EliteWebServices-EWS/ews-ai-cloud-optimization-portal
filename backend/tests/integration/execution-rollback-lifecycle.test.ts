import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXECUTION_MODES } from '../../execution/adapters/types';
import {
  buildOrchestratorContext,
  createTestOrchestrator,
  TENANT_A,
  TENANT_B,
} from './execution/fixtures';

describe('Execution rollback lifecycle integration', () => {
  it('rolls back after verification failure and persists rollback state', async () => {
    let describeCount = 0;
    const ec2 = {
      send: async (command: { constructor: { name: string } }) => {
        if (command.constructor.name === 'DescribeInstancesCommand') {
          describeCount += 1;
          const state = describeCount === 1 ? 'stopped' : 'stopped';
          return {
            Reservations: [
              {
                Instances: [
                  { InstanceId: 'i-rb', State: { Name: state }, Tags: [] },
                ],
              },
            ],
          };
        }
        if (command.constructor.name === 'StartInstancesCommand') {
          return {};
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
      action: 'START_INSTANCE',
      resourceId: 'i-rb',
    });

    assert.equal(result.status, 'ROLLED_BACK');
    const persisted = await runs.getById(TENANT_A, result.runId);
    assert.equal(persisted?.status, 'ROLLED_BACK');
    assert.ok(persisted?.rollbackResult);
    assert.ok(result.failure);
  });

  it('does not expose tenant B runs to tenant A queries', async () => {
    const { runs } = createTestOrchestrator();
    await runs.create({
      tenantId: TENANT_B,
      runId: 'run-b-1',
      correlationId: 'c',
      requestId: 'r',
      actorId: 'a',
      mode: 'PRODUCTION',
      service: 'ec2',
      action: 'START_INSTANCE',
      resourceId: 'i-1',
      region: 'us-east-1',
      status: 'FAILED',
      rollbackState: { eligible: false },
    });

    assert.equal(await runs.getById(TENANT_A, 'run-b-1'), undefined);
  });

  it('dry-run never invokes execute path on adapter registry production flow', async () => {
    let mutateCalled = false;
    const { orchestrator } = createTestOrchestrator(() => ({
      ec2: {
        send: async (command: { constructor: { name: string } }) => {
          if (command.constructor.name === 'StartInstancesCommand') {
            mutateCalled = true;
          }
          return {
            Reservations: [
              {
                Instances: [
                  { InstanceId: 'i-1', State: { Name: 'stopped' }, Tags: [] },
                ],
              },
            ],
          };
        },
      } as never,
    }));

    await orchestrator.run(
      buildOrchestratorContext({ mode: EXECUTION_MODES.DRY_RUN }),
      { service: 'ec2', action: 'START_INSTANCE', resourceId: 'i-1' },
    );

    assert.equal(mutateCalled, false);
  });
});
