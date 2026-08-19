import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareActionLogRecords,
  sortActionLogRecords,
} from '../../action-log/event-ordering';
import { prepareActionLogRecord } from '../../action-log/record-builder';
import type { ActionLogRecord } from '../../action-log/types';
import { ACCOUNT_A, TENANT_A } from '../fixtures/evidence/identities';

function buildRecord(overrides: Partial<ActionLogRecord>): ActionLogRecord {
  return {
    ...prepareActionLogRecord({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      correlationId: 'corr-order',
      eventType: 'PERSISTENCE_EVALUATED',
      sourceStage: 'PERSISTENCE',
      sourceRecordId: 'persist-1',
      occurredAt: '2026-08-10T12:00:00.000Z',
    }),
    ...overrides,
  };
}

test('same occurredAt orders by orderKey then logicalEventId', () => {
  const left = buildRecord({
    orderKey: 'PERSISTENCE#persist-a#1',
    logicalEventId: 'aaa',
    eventId: 'aaa',
  });
  const right = buildRecord({
    orderKey: 'PERSISTENCE#persist-b#1',
    logicalEventId: 'bbb',
    eventId: 'bbb',
  });

  assert.ok(compareActionLogRecords(left, right) < 0);
});

test('late-arriving higher occurredAt sorts after earlier domain events', () => {
  const early = buildRecord({
    occurredAt: '2026-08-10T12:00:00.000Z',
    logicalEventId: 'early',
    eventId: 'early',
  });
  const late = buildRecord({
    occurredAt: '2026-08-12T12:00:00.000Z',
    recordedAt: '2026-08-13T12:00:00.000Z',
    logicalEventId: 'late',
    eventId: 'late',
  });

  const sorted = sortActionLogRecords([late, early]);
  assert.deepEqual(
    sorted.map((record) => record.logicalEventId),
    ['early', 'late'],
  );
});

test('recordedAt does not affect ordering', () => {
  const firstRecordedLater = buildRecord({
    occurredAt: '2026-08-10T12:00:00.000Z',
    recordedAt: '2026-08-15T12:00:00.000Z',
    orderKey: 'A#1#1',
    logicalEventId: 'a',
    eventId: 'a',
  });
  const secondRecordedEarlier = buildRecord({
    occurredAt: '2026-08-10T12:00:00.000Z',
    recordedAt: '2026-08-11T12:00:00.000Z',
    orderKey: 'B#1#1',
    logicalEventId: 'b',
    eventId: 'b',
  });

  assert.ok(
    compareActionLogRecords(firstRecordedLater, secondRecordedEarlier) < 0,
  );
});
