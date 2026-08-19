import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLogicalActionLogEventId,
  buildActionLogOrderKey,
} from '../../action-log/event-identity';
import { prepareActionLogRecord } from '../../action-log/record-builder';
import { TENANT_A, ACCOUNT_A } from '../fixtures/evidence/identities';

test('buildLogicalActionLogEventId is deterministic', () => {
  const input = {
    tenantId: TENANT_A,
    correlationId: 'corr-id-1',
    accountId: ACCOUNT_A,
    eventType: 'PERSISTENCE_EVALUATED' as const,
    sourceStage: 'PERSISTENCE' as const,
    sourceRecordId: 'persist-1',
    sourceRecordVersion: '1',
  };

  const first = buildLogicalActionLogEventId(input);
  const second = buildLogicalActionLogEventId(input);
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('different material events produce different logical ids', () => {
  const base = {
    tenantId: TENANT_A,
    correlationId: 'corr-id-1',
    eventType: 'PERSISTENCE_EVALUATED' as const,
    sourceStage: 'PERSISTENCE' as const,
    sourceRecordId: 'persist-1',
    sourceRecordVersion: '1',
  };

  const first = buildLogicalActionLogEventId(base);
  const second = buildLogicalActionLogEventId({
    ...base,
    sourceRecordVersion: '2',
  });

  assert.notEqual(first, second);
});

test('same source record under different correlationIds does not collapse', () => {
  const shared = {
    tenantId: TENANT_A,
    eventType: 'GOVERNANCE_EVALUATED' as const,
    sourceStage: 'GOVERNANCE' as const,
    sourceRecordId: 'gov-result-1',
    sourceRecordVersion: '1.0.0',
  };

  const first = buildLogicalActionLogEventId({
    ...shared,
    correlationId: 'corr-a',
  });
  const second = buildLogicalActionLogEventId({
    ...shared,
    correlationId: 'corr-b',
  });

  assert.notEqual(first, second);
});

test('v1 eventId intentionally equals logicalEventId at record materialization', () => {
  const record = prepareActionLogRecord({
    tenantId: TENANT_A,
    correlationId: 'corr-event-id',
    eventType: 'RECOMMENDATION_OBSERVED',
    sourceStage: 'RECOMMENDATION',
    sourceRecordId: 'obs-1',
    occurredAt: '2026-08-10T12:00:00.000Z',
  });
  assert.equal(record.eventId, record.logicalEventId);
});

test('buildActionLogOrderKey includes stage and version', () => {
  assert.equal(
    buildActionLogOrderKey({
      sourceStage: 'GOVERNANCE',
      sourceRecordId: 'gov-1',
      sourceRecordVersion: '3',
    }),
    'GOVERNANCE#gov-1#3',
  );
});
