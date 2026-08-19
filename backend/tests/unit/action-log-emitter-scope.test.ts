import assert from 'node:assert/strict';
import test from 'node:test';

import { ActionLogEmitter } from '../../action-log/action-log-emitter';
import { buildLogicalActionLogEventId } from '../../action-log/event-identity';
import { ActionLogValidationError } from '../../action-log/types';
import { MockActionLogRepository } from '../../repositories/mock/mock-action-log-repository';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import { ActionLogService } from '../../services/action-log-service';
import { buildRecordEvidenceObservationInput } from '../fixtures/evidence/observation-builders';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  TENANT_A,
  TENANT_B,
} from '../fixtures/evidence/identities';

function createEmitter() {
  return new ActionLogEmitter(new ActionLogService(new MockActionLogRepository()));
}

test('rejects Tenant A stage output with Tenant B lifecycle context', async () => {
  const observations = new MockEvidenceObservationRepository();
  const emitter = createEmitter();
  const recorded = await observations.recordObservation(
    buildRecordEvidenceObservationInput({
      identity: { tenantId: TENANT_A, accountId: ACCOUNT_A },
      correlationId: 'corr-tenant-mismatch',
      recommendationId: 'rec-a',
    }),
  );

  await assert.rejects(
    () =>
      emitter.emitAfterEvidenceObservation({
        result: recorded,
        context: {
          tenantId: TENANT_B,
          accountId: ACCOUNT_B,
          correlationId: 'corr-tenant-mismatch',
          recommendationId: 'rec-a',
        },
      }),
    ActionLogValidationError,
  );
});

test('rejects same tenant with Account A stage output and Account B lifecycle context', async () => {
  const observations = new MockEvidenceObservationRepository();
  const emitter = createEmitter();
  const recorded = await observations.recordObservation(
    buildRecordEvidenceObservationInput({
      identity: { tenantId: TENANT_A, accountId: ACCOUNT_A },
      correlationId: 'corr-account-mismatch',
      recommendationId: 'rec-a',
    }),
  );

  await assert.rejects(
    () =>
      emitter.emitAfterEvidenceObservation({
        result: recorded,
        context: {
          tenantId: TENANT_A,
          accountId: ACCOUNT_B,
          correlationId: 'corr-account-mismatch',
          recommendationId: 'rec-a',
        },
      }),
    ActionLogValidationError,
  );
});

test('accepts matching tenant and account lifecycle context', async () => {
  const observations = new MockEvidenceObservationRepository();
  const emitter = createEmitter();
  const input = buildRecordEvidenceObservationInput({
    identity: { tenantId: TENANT_A, accountId: ACCOUNT_A },
    correlationId: 'corr-match',
    recommendationId: 'rec-a',
  });
  const recorded = await observations.recordObservation(input);

  const events = await emitter.emitAfterEvidenceObservation({
    result: recorded,
    context: {
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      correlationId: 'corr-match',
      recommendationId: input.recommendationId,
    },
  });

  assert.equal(events.length, 2);
  assert.equal(events[0]?.created, true);
});

test('same source identity under two accounts yields different default logicalEventId', () => {
  const shared = {
    tenantId: TENANT_A,
    correlationId: 'corr-shared',
    eventType: 'PERSISTENCE_EVALUATED' as const,
    sourceStage: 'PERSISTENCE' as const,
    sourceRecordId: 'persist-shared',
    sourceRecordVersion: '1',
  };

  const accountA = buildLogicalActionLogEventId({
    ...shared,
    accountId: ACCOUNT_A,
  });
  const accountB = buildLogicalActionLogEventId({
    ...shared,
    accountId: ACCOUNT_B,
  });

  assert.notEqual(accountA, accountB);
});
