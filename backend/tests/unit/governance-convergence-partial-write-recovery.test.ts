import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { cloudResourceAccountPartitionKey } from '../../database';
import {
  buildGovernanceConvergenceFindingKey,
  governanceConvergenceObservationResultSortKey,
} from '../../database/cloud-resources/governance-convergence-keys';
import { computeGovernanceEvidenceFingerprint } from '../../governance-convergence/governance-evidence-fingerprint';
import { buildObservationBackedLogicalResultId } from '../../governance-convergence/governance-convergence-result-identity';
import { buildLogicalObservationId } from '../../governance-convergence/observation-ordering';
import { normalizeObservationTimestampIso } from '../../governance-convergence/timestamp-rules';
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

describe('Governance convergence partial-write recovery', () => {
  it('mock recovers a missing convergence result on duplicate observation retry', async () => {
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
    assert.equal(first.created, true);
    assert.equal(first.result?.state, 'IMPROVED');

    const logicalResultId = first.result!.resultId;
    const indexKey = `${TENANT_A}#${ACCOUNT}#${findingKey()}`;
    const results = (repo as unknown as { resultsByFinding: Map<string, unknown[]> }).resultsByFinding;
    const filtered = (results.get(indexKey) ?? []).filter(
      (item) => (item as { resultId: string }).resultId !== logicalResultId,
    );
    results.set(indexKey, filtered);

    const retry = await repo.recordObservation(input);
    assert.equal(retry.created, false);
    assert.equal(retry.result?.state, 'IMPROVED');
    assert.equal(retry.result?.resultId, logicalResultId);
  });

  it('DynamoDB recovers a missing convergence result on duplicate observation retry', async () => {
    const { client } = createLinkedFakePersistenceTables();
    const fakeClient = client as unknown as DynamoDBDocumentClient & {
      store: Map<string, Record<string, unknown>>;
    };
    const repo = new DynamoDbGovernanceConvergenceRepository(fakeClient, 'sisum-cloud-resources-test');

    await repo.recordObservation(
      observationInput({ analysisRunId: 'run-0', observationTimestamp: '2026-08-01T00:00:00.000Z', satisfied: false }),
    );
    const input = observationInput({
      analysisRunId: 'run-1',
      observationTimestamp: '2026-08-02T00:00:00.000Z',
      satisfied: true,
    });
    const first = await repo.recordObservation(input);
    assert.equal(first.result?.state, 'IMPROVED');

    const logicalObservationId = buildLogicalObservationId({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
      analysisRunId: input.analysisRunId,
      observationTimestamp: input.observationTimestamp,
    });
    const logicalResultId = buildObservationBackedLogicalResultId({
      tenantId: TENANT_A,
      accountId: ACCOUNT,
      findingKey: findingKey(),
      logicalObservationId,
    });
    const pk = cloudResourceAccountPartitionKey(TENANT_A, ACCOUNT);
    const sk = governanceConvergenceObservationResultSortKey({
      findingKey: findingKey(),
      sourceObservationTimestampIso: normalizeObservationTimestampIso(input.observationTimestamp),
      logicalResultId,
    });
    fakeClient.store.delete(`${pk}||${sk}`);

    const retry = await repo.recordObservation(input);
    assert.equal(retry.created, false);
    assert.equal(retry.result?.state, 'IMPROVED');
    assert.equal(retry.result?.resultId, logicalResultId);
  });

  it('mock MISSING retry after simulated write failure remains idempotent', async () => {
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
    assert.equal(first?.state, 'MISSING');

    const indexKey = `${TENANT_A}#${ACCOUNT}#${findingKey()}`;
    const results = (repo as unknown as { resultsByFinding: Map<string, unknown[]> }).resultsByFinding;
    results.set(indexKey, []);

    const retry = await repo.recordMissingEvidence(missingInput);
    assert.equal(retry?.state, 'MISSING');
    assert.equal(retry?.resultId, first?.resultId);
  });
});
