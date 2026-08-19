import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import { DynamoDbEvidenceObservationRepository } from '../../repositories/dynamodb/dynamodb-evidence-observation-repository';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  TENANT_A,
  TENANT_B,
  buildManyHistoricalObservations,
  buildRecordEvidenceObservationInput,
} from '../fixtures/evidence';
import { createLinkedFakePersistenceTables } from './support/fake-persistence-table';

describe('EvidenceObservationRepository latest lookup', () => {
  it('mock returns latest observation for tenant/account/finding scope', async () => {
    const repo = new MockEvidenceObservationRepository();
    const first = buildRecordEvidenceObservationInput({
      analysisRunId: 'run-1',
      observationTimestamp: '2026-08-01T10:00:00.000Z',
    });
    const second = buildRecordEvidenceObservationInput({
      analysisRunId: 'run-2',
      observationTimestamp: '2026-08-02T10:00:00.000Z',
    });
    await repo.recordObservation(first);
    const secondResult = await repo.recordObservation(second);

    const latest = await repo.getLatestObservationForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: first.findingKey,
    });
    assert.equal(latest?.observationId, secondResult.observation.observationId);
    assert.equal(latest?.analysisRunId, 'run-2');
  });

  it('mock isolates latest lookup by tenant', async () => {
    const repo = new MockEvidenceObservationRepository();
    const tenantAInput = buildRecordEvidenceObservationInput({ tenantId: TENANT_A });
    const tenantBInput = buildRecordEvidenceObservationInput({
      tenantId: TENANT_B,
      analysisRunId: 'run-b',
    });
    await repo.recordObservation(tenantAInput);
    await repo.recordObservation(tenantBInput);

    const latest = await repo.getLatestObservationForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: tenantAInput.findingKey,
    });
    assert.equal(latest?.tenantId, TENANT_A);
    assert.notEqual(latest?.tenantId, TENANT_B);
  });

  it('mock isolates latest lookup by account', async () => {
    const repo = new MockEvidenceObservationRepository();
    const accountAInput = buildRecordEvidenceObservationInput({ accountId: ACCOUNT_A });
    const accountBInput = buildRecordEvidenceObservationInput({
      accountId: ACCOUNT_B,
      analysisRunId: 'run-b',
    });
    await repo.recordObservation(accountAInput);
    await repo.recordObservation(accountBInput);

    const latest = await repo.getLatestObservationForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: accountAInput.findingKey,
    });
    assert.equal(latest?.accountId, ACCOUNT_A);
  });

  it('mock resolves latest among >100 historical observations', async () => {
    const repo = new MockEvidenceObservationRepository();
    const inputs = buildManyHistoricalObservations(101);
    for (const input of inputs) {
      await repo.recordObservation(input);
    }
    const latest = await repo.getLatestObservationForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: inputs[0]!.findingKey,
    });
    assert.equal(latest?.analysisRunId, 'run-hist-101');
  });

  it('mock uses deterministic ordering for equal timestamps', async () => {
    const repo = new MockEvidenceObservationRepository();
    const sharedTimestamp = '2026-08-01T12:00:00.000Z';
    await repo.recordObservation(
      buildRecordEvidenceObservationInput({
        analysisRunId: 'run-a',
        observationTimestamp: sharedTimestamp,
      }),
    );
    await repo.recordObservation(
      buildRecordEvidenceObservationInput({
        analysisRunId: 'run-b',
        observationTimestamp: sharedTimestamp,
      }),
    );
    const latest = await repo.getLatestObservationForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: buildRecordEvidenceObservationInput().findingKey,
    });
    assert.equal(latest?.analysisRunId, 'run-b');
  });

  it('DynamoDB returns latest observation with bounded query', async () => {
    const { client } = createLinkedFakePersistenceTables();
    const repo = new DynamoDbEvidenceObservationRepository(
      client as unknown as DynamoDBDocumentClient,
      'sisum-cloud-resources-test',
    );
    const first = buildRecordEvidenceObservationInput({
      analysisRunId: 'run-dynamo-1',
      observationTimestamp: '2026-08-01T10:00:00.000Z',
    });
    const second = buildRecordEvidenceObservationInput({
      analysisRunId: 'run-dynamo-2',
      observationTimestamp: '2026-08-03T10:00:00.000Z',
    });
    await repo.recordObservation(first);
    await repo.recordObservation(second);

    const latest = await repo.getLatestObservationForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: first.findingKey,
    });
    assert.equal(latest?.analysisRunId, 'run-dynamo-2');
  });
});
