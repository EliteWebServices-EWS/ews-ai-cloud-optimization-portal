import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { buildGovernanceConvergenceFindingKey } from '../../database/cloud-resources/governance-convergence-keys';
import { computeGovernanceEvidenceFingerprint } from '../../governance-convergence/governance-evidence-fingerprint';
import {
  buildLogicalObservationId,
  compareGovernanceObservationOrdering,
  resolveAnalysisRunStartedAtForOrdering,
  sortObservationsByObservationTimestamp,
} from '../../governance-convergence/observation-ordering';
import type {
  GovernanceEvidenceObservationRecord,
  RecordGovernanceEvidenceObservationInput,
} from '../../governance-convergence/types';
import { DynamoDbGovernanceConvergenceRepository } from '../../repositories/dynamodb/dynamodb-governance-convergence-repository';
import { MockGovernanceConvergenceRepository } from '../../repositories/mock/mock-governance-convergence-repository';
import { createLinkedFakePersistenceTables } from './support/fake-persistence-table';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const ACCOUNT = 'acct-1';
const REGION = 'us-east-1';
const RESOURCE = 'i-abc123';
const CHECK = 'unrestricted_ssh';
const SHARED_TS = '2026-08-18T12:00:00.000Z';

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
  const satisfied = overrides.satisfied ?? false;
  const ruleVersion = '1';
  const observationTimestamp = overrides.observationTimestamp ?? SHARED_TS;
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
    collectionTimestamp: observationTimestamp,
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

function chronologicalInputs(): {
  first: RecordGovernanceEvidenceObservationInput;
  second: RecordGovernanceEvidenceObservationInput;
} {
  const first = observationInput({
    analysisRunId: 'run-1',
    observationTimestamp: SHARED_TS,
    analysisRunStartedAt: '2026-08-18T11:59:59.000Z',
    satisfied: false,
  });
  const second = observationInput({
    analysisRunId: 'run-2',
    observationTimestamp: SHARED_TS,
    analysisRunStartedAt: '2026-08-18T12:00:01.000Z',
    satisfied: false,
  });
  return { first, second };
}

async function resultSnapshot(
  repo: MockGovernanceConvergenceRepository,
): Promise<Array<{ state: string; resultId: string }>> {
  const results = await repo.listResultsForFinding({
    tenantId: TENANT_A,
    accountId: ACCOUNT,
    findingKey: findingKey(),
  });
  return results.items.map((item) => ({ state: item.state, resultId: item.resultId }));
}

describe('governance observation total ordering', () => {
  it('MODEL A: chronological arrival A then B yields PRESERVED on B', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const { first, second } = chronologicalInputs();

    await repo.recordObservation(first);
    const bResult = await repo.recordObservation(second);

    assert.equal(bResult.result?.state, 'PRESERVED');
    assert.deepEqual(await resultSnapshot(repo), [{ state: 'PRESERVED', resultId: bResult.result!.resultId }]);
    assert.equal(first.observationTimestamp, SHARED_TS);
    assert.equal(second.observationTimestamp, SHARED_TS);
  });

  it('MODEL A: reverse arrival B then A leaves B unassessed and does not rewrite history', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const { first, second } = chronologicalInputs();

    const bFirst = await repo.recordObservation(second);
    assert.equal(bFirst.result, undefined);

    await repo.recordObservation(first);

    assert.deepEqual(await resultSnapshot(repo), []);
    const observations = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
    });
    assert.equal(observations.items.length, 2);
  });

  it('MODEL A: identical arrival sequence yields identical assessment history', async () => {
    const { first, second } = chronologicalInputs();
    const repoA = new MockGovernanceConvergenceRepository();
    const repoB = new MockGovernanceConvergenceRepository();

    for (const repo of [repoA, repoB]) {
      await repo.recordObservation(first);
      await repo.recordObservation(second);
    }

    assert.deepEqual(await resultSnapshot(repoA), await resultSnapshot(repoB));
  });

  it('DynamoDB matches mock for same-timestamp sequential observations', async () => {
    const { client } = createLinkedFakePersistenceTables();
    const repo = new DynamoDbGovernanceConvergenceRepository(
      client as unknown as DynamoDBDocumentClient,
      'sisum-cloud-resources-test',
    );
    const { first, second } = chronologicalInputs();

    await repo.recordObservation(first);
    const secondResult = await repo.recordObservation(second);
    assert.equal(secondResult.result?.state, 'PRESERVED');
  });

  it('is idempotent for duplicate logical observation retries', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const input = observationInput({
      analysisRunId: 'run-dup',
      observationTimestamp: SHARED_TS,
      analysisRunStartedAt: '2026-08-18T12:00:00.000Z',
      satisfied: false,
    });
    const first = await repo.recordObservation(input);
    const second = await repo.recordObservation(input);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.observation.logicalObservationId, second.observation.logicalObservationId);
    assert.equal(first.observation.observationTimestamp, SHARED_TS);
    assert.deepEqual(await resultSnapshot(repo), []);
  });

  it('uses logicalObservationId when observationTimestamp and analysisRunStartedAt are equal', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    const key = findingKey();
    const input1 = observationInput({
      analysisRunId: 'run-1',
      observationTimestamp: SHARED_TS,
      analysisRunStartedAt: SHARED_TS,
      satisfied: false,
    });
    const input2 = observationInput({
      analysisRunId: 'run-2',
      observationTimestamp: SHARED_TS,
      analysisRunStartedAt: SHARED_TS,
      satisfied: false,
    });
    const id1 = buildLogicalObservationId({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: key,
      analysisRunId: 'run-1',
      observationTimestamp: SHARED_TS,
    });
    const id2 = buildLogicalObservationId({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: key,
      analysisRunId: 'run-2',
      observationTimestamp: SHARED_TS,
    });

    if (id1.localeCompare(id2) < 0) {
      await repo.recordObservation(input1);
      const second = await repo.recordObservation(input2);
      assert.equal(second.result?.state, 'PRESERVED');
    } else {
      await repo.recordObservation(input2);
      const second = await repo.recordObservation(input1);
      assert.equal(second.result?.state, 'PRESERVED');
    }
  });

  it('classifies late out-of-order timestamps against predecessor present at insert time', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    await repo.recordObservation(
      observationInput({
        analysisRunId: 'run-a',
        observationTimestamp: '2026-08-01T10:00:00.000Z',
        analysisRunStartedAt: '2026-08-01T10:00:00.000Z',
        satisfied: false,
      }),
    );
    await repo.recordObservation(
      observationInput({
        analysisRunId: 'run-b',
        observationTimestamp: '2026-08-01T10:10:00.000Z',
        analysisRunStartedAt: '2026-08-01T10:10:00.000Z',
        satisfied: true,
      }),
    );
    const late = await repo.recordObservation(
      observationInput({
        analysisRunId: 'run-c',
        observationTimestamp: '2026-08-01T10:05:00.000Z',
        analysisRunStartedAt: '2026-08-01T10:05:00.000Z',
        satisfied: true,
      }),
    );
    assert.equal(late.result?.state, 'IMPROVED');
  });

  it('falls back to observationTimestamp when analysisRunStartedAt is absent on legacy rows', () => {
    const legacy = {
      observationTimestamp: SHARED_TS,
    } as GovernanceEvidenceObservationRecord;
    assert.equal(resolveAnalysisRunStartedAtForOrdering(legacy), SHARED_TS);
    assert.ok(
      compareGovernanceObservationOrdering(
        {
          observationTimestamp: SHARED_TS,
          analysisRunStartedAt: resolveAnalysisRunStartedAtForOrdering(legacy),
          logicalObservationId: '000000000000000000000000000000000000000000000000000000000000000a',
        },
        {
          observationTimestamp: SHARED_TS,
          analysisRunStartedAt: SHARED_TS,
          logicalObservationId: '000000000000000000000000000000000000000000000000000000000000000b',
        },
      ) < 0,
    );
  });

  it('preserves tenant isolation under same-timestamp ordering', async () => {
    const repo = new MockGovernanceConvergenceRepository();
    await repo.recordObservation(
      observationInput({
        tenantId: TENANT_A,
        analysisRunId: 'run-a1',
        observationTimestamp: SHARED_TS,
        analysisRunStartedAt: '2026-08-18T11:59:59.000Z',
      }),
    );
    await repo.recordObservation(
      observationInput({
        tenantId: TENANT_A,
        analysisRunId: 'run-a2',
        observationTimestamp: SHARED_TS,
        analysisRunStartedAt: '2026-08-18T12:00:01.000Z',
      }),
    );
    await repo.recordObservation(
      observationInput({
        tenantId: TENANT_B,
        findingKey: findingKey(TENANT_B),
        analysisRunId: 'run-b1',
        observationTimestamp: SHARED_TS,
        analysisRunStartedAt: '2026-08-18T11:59:59.000Z',
      }),
    );

    const tenantA = await repo.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(TENANT_A),
    });
    const tenantB = await repo.listObservationsForFinding({
      tenantId: TENANT_B,
      accountId: ACCOUNT,
      findingKey: findingKey(TENANT_B),
    });
    assert.equal(tenantA.items.length, 2);
    assert.equal(tenantB.items.length, 1);
    assert.deepEqual(
      sortObservationsByObservationTimestamp(tenantA.items).map((item) => item.analysisRunId),
      ['run-a1', 'run-a2'],
    );
  });
});
