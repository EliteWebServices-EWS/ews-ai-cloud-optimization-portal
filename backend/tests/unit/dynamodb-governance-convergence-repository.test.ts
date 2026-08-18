import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { buildGovernanceConvergenceFindingKey } from '../../database/cloud-resources/governance-convergence-keys';
import { computeGovernanceEvidenceFingerprint } from '../../governance-convergence/governance-evidence-fingerprint';
import { DynamoDbGovernanceConvergenceRepository } from '../../repositories/dynamodb/dynamodb-governance-convergence-repository';
import type { RecordGovernanceEvidenceObservationInput } from '../../governance-convergence/types';
import { createLinkedFakePersistenceTables } from './support/fake-persistence-table';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const ACCOUNT = 'acct-1';
const REGION = 'us-east-1';
const RESOURCE = 'i-abc123';
const CHECK = 'unrestricted_ssh';

function findingKey(tenantId = TENANT_A): string {
  return buildGovernanceConvergenceFindingKey({
    tenantId,
    accountId: ACCOUNT,
    region: REGION,
    resourceId: RESOURCE,
    check: CHECK,
  });
}

function observationInput(
  overrides: Partial<RecordGovernanceEvidenceObservationInput> & {
    satisfied?: boolean | undefined;
    tenantId?: string;
  } = {},
): RecordGovernanceEvidenceObservationInput {
  const tenantId = overrides.tenantId ?? TENANT_A;
  const satisfied = overrides.satisfied ?? true;
  const ruleVersion = '1';
  const observationTimestamp = overrides.observationTimestamp ?? '2026-08-01T00:00:00.000Z';
  const analysisRunStartedAt = overrides.analysisRunStartedAt ?? observationTimestamp;
  return {
    tenantId,
    accountId: ACCOUNT,
    region: REGION,
    resourceId: RESOURCE,
    check: CHECK,
    findingKey: overrides.findingKey ?? findingKey(tenantId),
    analysisRunId: 'run-1',
    analysisRunStartedAt,
    observationTimestamp,
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

function createRepository(): DynamoDbGovernanceConvergenceRepository {
  const { client } = createLinkedFakePersistenceTables();
  return new DynamoDbGovernanceConvergenceRepository(
    client as unknown as DynamoDBDocumentClient,
    'sisum-cloud-resources-test',
  );
}

describe('DynamoDbGovernanceConvergenceRepository parity', () => {
  it('records a first observation with no result yet', async () => {
    const repo = createRepository();
    const result = await repo.recordObservation(observationInput());
    assert.equal(result.created, true);
    assert.equal(result.result, undefined);
  });

  it('deduplicates exact logical observations', async () => {
    const repo = createRepository();
    const input = observationInput({ analysisRunId: 'run-dynamo-dup' });
    const first = await repo.recordObservation(input);
    const second = await repo.recordObservation(input);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.observation.observationId, second.observation.observationId);
  });

  it('replays a violation → resolved → unchanged sequence as null → IMPROVED → PRESERVED', async () => {
    const repo = createRepository();
    const key = findingKey();

    const first = await repo.recordObservation(
      observationInput({ analysisRunId: 'run-1', observationTimestamp: '2026-08-01T00:00:00.000Z', satisfied: false }),
    );
    const second = await repo.recordObservation(
      observationInput({ analysisRunId: 'run-2', observationTimestamp: '2026-08-02T00:00:00.000Z', satisfied: true }),
    );
    const third = await repo.recordObservation(
      observationInput({ analysisRunId: 'run-3', observationTimestamp: '2026-08-03T00:00:00.000Z', satisfied: true }),
    );

    assert.equal(first.result, undefined);
    assert.equal(second.result?.state, 'IMPROVED');
    assert.equal(third.result?.state, 'PRESERVED');

    const results = await repo.listResultsForFinding({ tenantId: TENANT_A, accountId: ACCOUNT, findingKey: key });
    assert.deepEqual(results.items.map((r) => r.state), ['IMPROVED', 'PRESERVED']);
  });

  it('classifies a late-arriving out-of-order observation against its true chronological predecessor', async () => {
    const repo = createRepository();

    await repo.recordObservation(
      observationInput({ analysisRunId: 'run-a', observationTimestamp: '2026-08-01T10:00:00.000Z', satisfied: false }),
    );
    await repo.recordObservation(
      observationInput({ analysisRunId: 'run-b', observationTimestamp: '2026-08-01T10:10:00.000Z', satisfied: true }),
    );
    const late = await repo.recordObservation(
      observationInput({ analysisRunId: 'run-c', observationTimestamp: '2026-08-01T10:05:00.000Z', satisfied: true }),
    );

    assert.equal(late.result?.state, 'IMPROVED');
  });

  it('records MISSING when expected evidence disappears, without touching the observation log', async () => {
    const repo = createRepository();
    const key = findingKey();
    await repo.recordObservation(observationInput({ analysisRunId: 'run-1', satisfied: true }));

    const missing = await repo.recordMissingEvidence({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: key,
      analysisRunId: 'run-2',
      evaluatedAt: '2026-08-02T00:00:00.000Z',
    });

    assert.equal(missing?.state, 'MISSING');
    const observations = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: key,
    });
    assert.equal(observations.items.length, 1);
  });

  it('is a no-op for missing evidence with no prior observation', async () => {
    const repo = createRepository();
    const result = await repo.recordMissingEvidence({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
      analysisRunId: 'run-1',
      evaluatedAt: '2026-08-01T00:00:00.000Z',
    });
    assert.equal(result, null);
  });

  it('never returns another tenant\'s observations or results', async () => {
    const repo = createRepository();
    await repo.recordObservation(observationInput({ tenantId: TENANT_A, satisfied: false }));
    await repo.recordObservation(observationInput({ tenantId: TENANT_B, satisfied: true }));

    const aObservations = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(TENANT_A),
    });
    assert.equal(aObservations.items.length, 1);
    assert.equal(aObservations.items[0]?.tenantId, TENANT_A);

    const crossTenantRead = await repo.getObservationByLogicalId({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(TENANT_B),
      analysisRunId: 'run-1',
      observationTimestamp: '2026-08-01T00:00:00.000Z',
    });
    assert.equal(crossTenantRead, null);
  });

  it('resolves ownership from the finding key', async () => {
    const repo = createRepository();
    assert.equal(await repo.resolveOwnerTenantId(findingKey(TENANT_B)), TENANT_B);
  });

  it('survives a fresh repository instance over the same table (Lambda cold-start restart)', async () => {
    const { client } = createLinkedFakePersistenceTables();
    const tableName = 'sisum-cloud-resources-test';
    const first = new DynamoDbGovernanceConvergenceRepository(client as unknown as DynamoDBDocumentClient, tableName);
    await first.recordObservation(observationInput({ analysisRunId: 'run-1', satisfied: false }));
    await first.recordObservation(
      observationInput({ analysisRunId: 'run-2', observationTimestamp: '2026-08-02T00:00:00.000Z', satisfied: true }),
    );

    const afterRestart = new DynamoDbGovernanceConvergenceRepository(
      client as unknown as DynamoDBDocumentClient,
      tableName,
    );
    const latest = await afterRestart.getLatestResult(TENANT_A, ACCOUNT, findingKey());
    assert.equal(latest?.state, 'IMPROVED');
  });

  it('paginates results for a finding', async () => {
    const repo = createRepository();
    for (let i = 0; i < 4; i += 1) {
      await repo.recordObservation(
        observationInput({
          analysisRunId: `run-${i}`,
          observationTimestamp: `2026-08-0${i + 1}T00:00:00.000Z`,
          satisfied: i % 2 === 0,
        }),
      );
    }
    const page = await repo.listResultsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
      limit: 2,
    });
    assert.equal(page.items.length, 2);
    assert.ok(page.nextToken);
  });
});
