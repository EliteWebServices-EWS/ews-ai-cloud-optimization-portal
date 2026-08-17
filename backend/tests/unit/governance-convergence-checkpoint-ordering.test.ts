import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { buildGovernanceConvergenceFindingKey } from '../../database/cloud-resources/governance-convergence-keys';
import { GOVERNANCE_TRACKED_CHECKS } from '../../governance-convergence/governance-evidence-reuse';
import { compareLatestObservedControlOrdering } from '../../governance-convergence/observation-ordering';
import { DynamoDbGovernanceConvergenceRepository } from '../../repositories/dynamodb/dynamodb-governance-convergence-repository';
import { MockGovernanceConvergenceRepository } from '../../repositories/mock/mock-governance-convergence-repository';
import { createLinkedFakePersistenceTables } from './support/fake-persistence-table';

const TENANT = 'tenant-a';
const ACCOUNT = '111122223333';
const REGION = 'us-east-1';
const RESOURCE = 'i-ordering';
const TIMESTAMP = '2026-08-03T00:00:00.000Z';
const LOGICAL_A = '000000000000000000000000000000000000000000000000000000000000000a';
const LOGICAL_B = '000000000000000000000000000000000000000000000000000000000000000b';

function checkpointCandidate(logicalObservationId: string, observationId: string) {
  return {
    tenantId: TENANT,
    accountId: ACCOUNT,
    region: REGION,
    resourceId: RESOURCE,
    check: GOVERNANCE_TRACKED_CHECKS.SSH_EXPOSURE,
    findingKey: buildGovernanceConvergenceFindingKey({
      tenantId: TENANT,
      accountId: ACCOUNT,
      region: REGION,
      resourceId: RESOURCE,
      check: GOVERNANCE_TRACKED_CHECKS.SSH_EXPOSURE,
    }),
    latestObservationId: observationId,
    latestLogicalObservationId: logicalObservationId,
    latestObservationTimestamp: TIMESTAMP,
    latestAnalysisRunId: 'run-1',
    latestRuleVersion: '1',
    resourceLifecycleStatus: 'ACTIVE' as const,
  };
}

async function readCheckpoint(
  repo: MockGovernanceConvergenceRepository | DynamoDbGovernanceConvergenceRepository,
): Promise<string | undefined> {
  return (
    await repo.listLatestObservedControls({
      tenantId: TENANT,
      accountId: ACCOUNT,
      regions: [REGION],
    })
  ).items[0]?.latestLogicalObservationId;
}

describe('governance latest checkpoint ordering', () => {
  it('uses observationTimestamp then logicalObservationId for canonical ordering', () => {
    assert.ok(
      compareLatestObservedControlOrdering(
        { latestObservationTimestamp: '2026-08-02T00:00:00.000Z', latestLogicalObservationId: LOGICAL_A },
        { latestObservationTimestamp: TIMESTAMP, latestLogicalObservationId: LOGICAL_B },
      ) < 0,
    );
    assert.ok(
      compareLatestObservedControlOrdering(
        { latestObservationTimestamp: TIMESTAMP, latestLogicalObservationId: LOGICAL_B },
        { latestObservationTimestamp: TIMESTAMP, latestLogicalObservationId: LOGICAL_A },
      ) > 0,
    );
  });

  it('mock chooses the same winner regardless of insertion order at equal timestamp', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    await repo.upsertLatestObservedControl(checkpointCandidate(LOGICAL_A, 'obs-a'));
    await repo.upsertLatestObservedControl(checkpointCandidate(LOGICAL_B, 'obs-b'));
    assert.equal(await readCheckpoint(repo), LOGICAL_B);

    const reverse = new MockGovernanceConvergenceRepository();
    await reverse.upsertLatestObservedControl(checkpointCandidate(LOGICAL_B, 'obs-b'));
    await reverse.upsertLatestObservedControl(checkpointCandidate(LOGICAL_A, 'obs-a'));
    assert.equal(await readCheckpoint(reverse), LOGICAL_B);
  });

  it('DynamoDB chooses the same winner regardless of insertion order at equal timestamp', async () => {
    const { client } = createLinkedFakePersistenceTables();
    const repo = new DynamoDbGovernanceConvergenceRepository(
      client as unknown as DynamoDBDocumentClient,
      'sisum-cloud-resources-test',
    );
    await repo.upsertLatestObservedControl(checkpointCandidate(LOGICAL_A, 'obs-a'));
    await repo.upsertLatestObservedControl(checkpointCandidate(LOGICAL_B, 'obs-b'));
    assert.equal(await readCheckpoint(repo), LOGICAL_B);

    const { client: reverseClient } = createLinkedFakePersistenceTables();
    const reverse = new DynamoDbGovernanceConvergenceRepository(
      reverseClient as unknown as DynamoDBDocumentClient,
      'sisum-cloud-resources-test',
    );
    await reverse.upsertLatestObservedControl(checkpointCandidate(LOGICAL_B, 'obs-b'));
    await reverse.upsertLatestObservedControl(checkpointCandidate(LOGICAL_A, 'obs-a'));
    assert.equal(await readCheckpoint(reverse), LOGICAL_B);
  });

  it('mock concurrent same-timestamp updates converge to one deterministic winner', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    await Promise.all([
      repo.upsertLatestObservedControl(checkpointCandidate(LOGICAL_A, 'obs-a')),
      repo.upsertLatestObservedControl(checkpointCandidate(LOGICAL_B, 'obs-b')),
    ]);
    assert.equal(await readCheckpoint(repo), LOGICAL_B);
  });

  it('DynamoDB concurrent same-timestamp updates converge to one deterministic winner', async () => {
    const { client } = createLinkedFakePersistenceTables();
    const repo = new DynamoDbGovernanceConvergenceRepository(
      client as unknown as DynamoDBDocumentClient,
      'sisum-cloud-resources-test',
    );
    await Promise.all([
      repo.upsertLatestObservedControl(checkpointCandidate(LOGICAL_A, 'obs-a')),
      repo.upsertLatestObservedControl(checkpointCandidate(LOGICAL_B, 'obs-b')),
    ]);
    assert.equal(await readCheckpoint(repo), LOGICAL_B);
  });
});
