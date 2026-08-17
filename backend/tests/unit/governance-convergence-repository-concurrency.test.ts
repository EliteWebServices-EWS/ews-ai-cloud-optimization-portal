import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { buildGovernanceConvergenceFindingKey } from '../../database/cloud-resources/governance-convergence-keys';
import { computeGovernanceEvidenceFingerprint } from '../../governance-convergence/governance-evidence-fingerprint';
import { buildObservationBackedLogicalResultId } from '../../governance-convergence/governance-convergence-result-identity';
import { buildLogicalObservationId } from '../../governance-convergence/observation-ordering';
import type { RecordGovernanceEvidenceObservationInput } from '../../governance-convergence/types';
import { DynamoDbGovernanceConvergenceRepository } from '../../repositories/dynamodb/dynamodb-governance-convergence-repository';
import { MockGovernanceConvergenceRepository } from '../../repositories/mock/mock-governance-convergence-repository';
import { createLinkedFakePersistenceTables } from './support/fake-persistence-table';

const TENANT_A = 'tenant-a';
const ACCOUNT = 'acct-1';
const REGION = 'us-east-1';
const RESOURCE = 'i-abc123';
const CHECK = 'unrestricted_ssh';

function findingKey(): string {
  return buildGovernanceConvergenceFindingKey({
    tenantId: TENANT_A,
    accountId: ACCOUNT,
    region: REGION,
    resourceId: RESOURCE,
    check: CHECK,
  });
}

function observationInput(
  overrides: Partial<RecordGovernanceEvidenceObservationInput> & { satisfied?: boolean | undefined } = {},
): RecordGovernanceEvidenceObservationInput {
  const satisfied = overrides.satisfied ?? true;
  const ruleVersion = '1';
  return {
    tenantId: TENANT_A,
    accountId: ACCOUNT,
    region: REGION,
    resourceId: RESOURCE,
    check: CHECK,
    findingKey: findingKey(),
    analysisRunId: 'run-1',
    observationTimestamp: '2026-08-01T00:00:00.000Z',
    collectionTimestamp: '2026-08-01T00:00:00.000Z',
    evidence: {
      satisfied,
      check: CHECK,
      category: 'security',
      fingerprint: computeGovernanceEvidenceFingerprint({ check: CHECK, satisfied, ruleVersion }),
      ruleVersion,
    },
    ...overrides,
  };
}

describe('Governance convergence repository concurrency', () => {
  it('mock concurrent duplicate observations create one observation and one result', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    await repo.recordObservation(
      observationInput({ analysisRunId: 'run-0', observationTimestamp: '2026-08-01T00:00:00.000Z', satisfied: false }),
    );
    const input = observationInput({
      analysisRunId: 'run-1',
      observationTimestamp: '2026-08-02T00:00:00.000Z',
      satisfied: true,
    });
    const [first, second] = await Promise.all([repo.recordObservation(input), repo.recordObservation(input)]);

    const createdCount = [first, second].filter((result) => result.created).length;
    assert.equal(createdCount, 1);
    assert.equal(first.observation.observationId, second.observation.observationId);
    assert.ok(first.result ?? second.result);
    assert.equal((first.result ?? second.result)?.state, 'IMPROVED');

    const observations = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
    });
    assert.equal(observations.items.length, 2);

    const results = await repo.listResultsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
    });
    assert.equal(results.items.length, 1);
  });

  it('DynamoDB concurrent duplicate observations create one observation and one result', async () => {
    const { client } = createLinkedFakePersistenceTables();
    const repo = new DynamoDbGovernanceConvergenceRepository(
      client as unknown as DynamoDBDocumentClient,
      'sisum-cloud-resources-test',
    );
    await repo.recordObservation(
      observationInput({ analysisRunId: 'run-0', observationTimestamp: '2026-08-01T00:00:00.000Z', satisfied: false }),
    );
    const input = observationInput({
      analysisRunId: 'run-1',
      observationTimestamp: '2026-08-02T00:00:00.000Z',
      satisfied: true,
    });
    const [first, second] = await Promise.all([repo.recordObservation(input), repo.recordObservation(input)]);

    const createdCount = [first, second].filter((result) => result.created).length;
    assert.equal(createdCount, 1);
    assert.equal(first.observation.observationId, second.observation.observationId);
    assert.ok(first.result ?? second.result);
    assert.equal((first.result ?? second.result)?.state, 'IMPROVED');
  });

  it('mock duplicate MISSING calls create exactly one logical result', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    await repo.recordObservation(observationInput({ analysisRunId: 'run-1', satisfied: true }));
    const missingInput = {
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
      analysisRunId: 'run-2',
      evaluatedAt: '2026-08-02T00:00:00.000Z',
    };
    const first = await repo.recordMissingEvidence(missingInput);
    const second = await repo.recordMissingEvidence(missingInput);
    assert.equal(first?.resultId, second?.resultId);
    assert.equal(first?.state, 'MISSING');

    const results = await repo.listResultsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
    });
    assert.equal(results.items.filter((result) => result.state === 'MISSING').length, 1);
  });

  it('mock concurrent MISSING calls create exactly one logical result', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    await repo.recordObservation(observationInput({ analysisRunId: 'run-1', satisfied: true }));
    const missingInput = {
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
      analysisRunId: 'run-2',
      evaluatedAt: '2026-08-02T00:00:00.000Z',
    };
    const [first, second] = await Promise.all([
      repo.recordMissingEvidence(missingInput),
      repo.recordMissingEvidence(missingInput),
    ]);
    assert.equal(first?.resultId, second?.resultId);
    assert.equal(first?.state, 'MISSING');
  });

  it('DynamoDB duplicate MISSING calls create exactly one logical result', async () => {
    const { client } = createLinkedFakePersistenceTables();
    const repo = new DynamoDbGovernanceConvergenceRepository(
      client as unknown as DynamoDBDocumentClient,
      'sisum-cloud-resources-test',
    );
    await repo.recordObservation(observationInput({ analysisRunId: 'run-1', satisfied: true }));
    const missingInput = {
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
      analysisRunId: 'run-2',
      evaluatedAt: '2026-08-02T00:00:00.000Z',
    };
    const first = await repo.recordMissingEvidence(missingInput);
    const second = await repo.recordMissingEvidence(missingInput);
    assert.equal(first?.resultId, second?.resultId);
  });

  it('duplicate observation replays return the same deterministic result identity', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    await repo.recordObservation(
      observationInput({ analysisRunId: 'run-0', observationTimestamp: '2026-08-01T00:00:00.000Z', satisfied: false }),
    );
    const input = observationInput({
      analysisRunId: 'run-1',
      observationTimestamp: '2026-08-02T00:00:00.000Z',
      satisfied: true,
    });
    const first = await repo.recordObservation(input);
    const replay = await repo.recordObservation(input);
    assert.equal(replay.created, false);
    assert.equal(replay.result?.resultId, first.result?.resultId);
    const logicalObservationId = buildLogicalObservationId({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
      analysisRunId: input.analysisRunId,
      observationTimestamp: input.observationTimestamp,
    });
    const expectedResultId = buildObservationBackedLogicalResultId({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
      logicalObservationId,
    });
    assert.equal(replay.result?.resultId, expectedResultId);
  });

  it('mock same-timestamp checkpoint updates prefer higher logicalObservationId', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const base = {
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      region: REGION,
      resourceId: RESOURCE,
      check: CHECK,
      findingKey: findingKey(),
      latestAnalysisRunId: 'run-1',
      latestRuleVersion: '1',
      resourceLifecycleStatus: 'ACTIVE' as const,
      latestObservationTimestamp: '2026-08-03T00:00:00.000Z',
    };
    await repo.upsertLatestObservedControl({
      ...base,
      latestObservationId: 'obs-a',
      latestLogicalObservationId: '000000000000000000000000000000000000000000000000000000000000000a',
    });
    await repo.upsertLatestObservedControl({
      ...base,
      latestObservationId: 'obs-b',
      latestLogicalObservationId: '000000000000000000000000000000000000000000000000000000000000000b',
    });
    const latest = (
      await repo.listLatestObservedControls({
        tenantId: TENANT_A,
        accountId: ACCOUNT,
        regions: [REGION],
      })
    ).items[0];
    assert.equal(
      latest?.latestLogicalObservationId,
      '000000000000000000000000000000000000000000000000000000000000000b',
    );
  });

  it('mock concurrent checkpoint updates converge to the newest observation timestamp', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const base = {
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      region: REGION,
      resourceId: RESOURCE,
      check: CHECK,
      findingKey: findingKey(),
      latestAnalysisRunId: 'run-1',
      latestRuleVersion: '1',
      resourceLifecycleStatus: 'ACTIVE' as const,
    };
    await Promise.all([
      repo.upsertLatestObservedControl({
        ...base,
        latestObservationId: 'obs-old',
        latestLogicalObservationId: 'log-old',
        latestObservationTimestamp: '2026-08-01T00:00:00.000Z',
      }),
      repo.upsertLatestObservedControl({
        ...base,
        latestObservationId: 'obs-new',
        latestLogicalObservationId: 'log-new',
        latestObservationTimestamp: '2026-08-03T00:00:00.000Z',
      }),
    ]);

    const latest = (
      await repo.listLatestObservedControls({
        tenantId: TENANT_A,
        accountId: ACCOUNT,
        regions: [REGION],
      })
    ).items[0];
    assert.equal(latest?.latestObservationTimestamp, '2026-08-03T00:00:00.000Z');
    assert.equal(latest?.latestObservationId, 'obs-new');
  });
});
