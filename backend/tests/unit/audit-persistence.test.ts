import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUDIT_EVENTS,
  buildAuditEvent,
  buildAuditPartitionKey,
  buildAuditSortKey,
  calculateAuditExpiresAt,
  enrichAuditEventForPersistence,
  fromDynamoDbItem,
  isAuditPersistenceEnabled,
  logPersistenceFailure,
  persistAuditEvent,
  queryAuditEvents,
  resetAuditRepository,
  setAuditRepository,
  shouldPersistAuditEvent,
  toDynamoDbItem,
  type AuditRepository,
} from '../../audit';

const sampleActor = {
  authenticated: true,
  userId: 'admin-123',
  email: 'admin@example.com',
  roles: ['admin'] as import('../../auth').SisumRole[],
};

test('buildAuditPartitionKey and buildAuditSortKey format keys correctly', () => {
  assert.equal(
    buildAuditPartitionKey('sisum-default'),
    'TENANT#sisum-default'
  );

  assert.equal(
    buildAuditSortKey(
      '2026-07-19T12:00:00.000Z',
      'event-abc'
    ),
    'AUDIT#2026-07-19T12:00:00.000Z#event-abc'
  );
});

test('calculateAuditExpiresAt applies retention days as TTL epoch seconds', () => {
  const expiresAt = calculateAuditExpiresAt(
    '2026-01-01T00:00:00.000Z',
    365
  );

  assert.equal(expiresAt, 1798761600);
});

test('enrichAuditEventForPersistence adds tenant and metadata', () => {
  const event = enrichAuditEventForPersistence(
    buildAuditEvent({
      eventName: AUDIT_EVENTS.WORKFLOW_COMPLETED,
      outcome: 'success',
      requestId: 'req-1',
      correlationId: 'corr-1',
      actor: sampleActor,
    })
  );

  assert.ok(event.eventId);
  assert.equal(event.tenantId, 'sisum-default');
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.source, 'workflow');
  assert.ok(event.expiresAt);
});

test('toDynamoDbItem serializes audit records without secret fields', () => {
  const event = enrichAuditEventForPersistence(
    buildAuditEvent({
      eventName: AUDIT_EVENTS.AUTHORIZATION_DENIED,
      outcome: 'denied',
      requestId: 'req-deny',
      correlationId: 'corr-deny',
      actor: sampleActor,
      path: '/api/v1/workflows/run',
      statusCode: 403,
    })
  );

  const item = toDynamoDbItem(
    {
      eventId: event.eventId!,
      timestamp: event.timestamp,
      eventName: event.eventName,
      outcome: event.outcome,
      level: event.level,
      actorUserId: event.actor.userId,
      actorEmail: event.actor.email,
      actorRoles: [...event.actor.roles],
      requestId: event.requestId,
      correlationId: event.correlationId,
      schemaVersion: event.schemaVersion!,
      expiresAt: event.expiresAt!,
      tenantId: event.tenantId!,
      environment: event.environment,
      path: event.path,
      statusCode: event.statusCode,
    }
  );

  const serialized = JSON.stringify(item).toLowerCase();

  assert.equal(item.pk, 'TENANT#sisum-default');
  assert.ok(String(item.sk).startsWith('AUDIT#'));
  assert.equal(serialized.includes('access_token'), false);
  assert.equal(serialized.includes('refresh_token'), false);
  assert.equal(serialized.includes('password'), false);
  assert.equal(serialized.includes('cookie'), false);
  assert.equal(serialized.includes('authorization header'), false);

  const roundTrip = fromDynamoDbItem(item);

  assert.equal(roundTrip.eventId, event.eventId);
  assert.equal(roundTrip.tenantId, 'sisum-default');
});

test('shouldPersistAuditEvent excludes noisy and recursive events', () => {
  assert.equal(
    shouldPersistAuditEvent(
      AUDIT_EVENTS.REQUEST_STARTED
    ),
    false
  );
  assert.equal(
    shouldPersistAuditEvent(
      AUDIT_EVENTS.REQUEST_COMPLETED
    ),
    false
  );
  assert.equal(
    shouldPersistAuditEvent(
      AUDIT_EVENTS.AUDIT_SEARCH_PERFORMED
    ),
    false
  );
  assert.equal(
    shouldPersistAuditEvent(
      AUDIT_EVENTS.WORKFLOW_COMPLETED
    ),
    true
  );
});

test('persistAuditEvent saves through repository when enabled', async () => {
  const saved: unknown[] = [];

  const repository: AuditRepository = {
    async save(event) {
      saved.push(event);
    },
    async query() {
      return { items: [] };
    },
  };

  process.env.AUDIT_PERSISTENCE_ENABLED = 'true';
  process.env.AUDIT_TABLE_NAME = 'sisum-audit-test';

  setAuditRepository(repository);

  await persistAuditEvent(
    buildAuditEvent({
      eventName: AUDIT_EVENTS.REPORT_GENERATED,
      outcome: 'success',
      requestId: 'req-save',
      correlationId: 'corr-save',
      actor: sampleActor,
      reportId: 'report-1',
    })
  );

  assert.equal(saved.length, 1);

  resetAuditRepository();
  delete process.env.AUDIT_PERSISTENCE_ENABLED;
  delete process.env.AUDIT_TABLE_NAME;
});

test('persistAuditEvent logs failure without throwing', async () => {
  const repository: AuditRepository = {
    async save() {
      throw new Error('DynamoDB unavailable');
    },
    async query() {
      return { items: [] };
    },
  };

  const errorLogs: string[] = [];
  const originalError = console.error;

  console.error = (message?: unknown) => {
    errorLogs.push(String(message));
  };

  process.env.AUDIT_PERSISTENCE_ENABLED = 'true';
  process.env.AUDIT_TABLE_NAME = 'sisum-audit-test';

  setAuditRepository(repository);

  await assert.doesNotReject(async () => {
    await persistAuditEvent(
      buildAuditEvent({
        eventName: AUDIT_EVENTS.WORKFLOW_FAILED,
        outcome: 'failure',
        requestId: 'req-fail',
        correlationId: 'corr-fail',
        actor: sampleActor,
      })
    );
  });

  assert.ok(
    errorLogs.some((entry) =>
      entry.includes('audit.persistence_failed')
    )
  );

  console.error = originalError;
  resetAuditRepository();
  delete process.env.AUDIT_PERSISTENCE_ENABLED;
  delete process.env.AUDIT_TABLE_NAME;
});

test('logPersistenceFailure never includes secret values from source event', () => {
  const logs: string[] = [];
  const originalError = console.error;

  console.error = (message?: unknown) => {
    logs.push(String(message));
  };

  logPersistenceFailure({
    event: enrichAuditEventForPersistence(
      buildAuditEvent({
        eventName: AUDIT_EVENTS.EXECUTION_SIMULATED,
        outcome: 'success',
        requestId: 'req-safe',
        correlationId: 'corr-safe',
        actor: sampleActor,
      })
    ),
    error: new Error('conditional failure'),
  });

  const serialized = logs.join(' ').toLowerCase();

  assert.ok(
    serialized.includes('audit.persistence_failed')
  );
  assert.equal(serialized.includes('secret'), false);
  assert.equal(serialized.includes('access_token'), false);

  console.error = originalError;
});

test('isAuditPersistenceEnabled respects environment flag', () => {
  process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
  assert.equal(isAuditPersistenceEnabled(), false);

  process.env.AUDIT_PERSISTENCE_ENABLED = 'true';
  assert.equal(isAuditPersistenceEnabled(), true);

  delete process.env.AUDIT_PERSISTENCE_ENABLED;
  assert.equal(isAuditPersistenceEnabled(), true);
});

test('queryAuditEvents uses repository when configured', async () => {
  const repository: AuditRepository = {
    async save() {},
    async query(filters) {
      return {
        items: [
          {
            eventId: 'event-1',
            timestamp: '2026-07-19T12:00:00.000Z',
            eventName: AUDIT_EVENTS.WORKFLOW_COMPLETED,
            outcome: 'success',
            level: 'info',
            actorUserId: 'admin-123',
            actorEmail: 'admin@example.com',
            actorRoles: ['admin'],
            requestId: 'req-1',
            correlationId: 'corr-1',
            schemaVersion: 1,
            expiresAt: 1800000000,
            tenantId: filters.tenantId,
            environment: 'test',
          },
        ],
      };
    },
  };

  process.env.AUDIT_PERSISTENCE_ENABLED = 'true';
  process.env.AUDIT_TABLE_NAME = 'sisum-audit-test';

  setAuditRepository(repository);

  const result = await queryAuditEvents({
    tenantId: 'sisum-default',
    limit: 10,
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].eventName, AUDIT_EVENTS.WORKFLOW_COMPLETED);

  resetAuditRepository();
  delete process.env.AUDIT_PERSISTENCE_ENABLED;
  delete process.env.AUDIT_TABLE_NAME;
});
