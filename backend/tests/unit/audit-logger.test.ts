import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUDIT_EVENTS,
  buildAuditEvent,
} from '../../audit';

test('buildAuditEvent creates a structured success event', () => {
  const event = buildAuditEvent({
    eventName: AUDIT_EVENTS.WORKFLOW_COMPLETED,
    outcome: 'success',
    requestId: 'request-123',
    correlationId: 'correlation-123',
    actor: {
      authenticated: true,
      userId: 'user-123',
      email: 'analyst@example.com',
      roles: ['analyst'],
    },
    action: 'workflow.run',
    workflowId: 'workflow-123',
    statusCode: 200,
    durationMs: 25,
  });

  assert.equal(event.category, 'audit');
  assert.equal(event.service, 'sisum-backend');
  assert.equal(
    event.eventName,
    AUDIT_EVENTS.WORKFLOW_COMPLETED
  );
  assert.equal(event.outcome, 'success');
  assert.equal(event.level, 'info');
  assert.equal(event.requestId, 'request-123');
  assert.equal(
    event.correlationId,
    'correlation-123'
  );
  assert.equal(event.actor.userId, 'user-123');
  assert.deepEqual(event.actor.roles, ['analyst']);
  assert.equal(event.workflowId, 'workflow-123');
  assert.equal(event.durationMs, 25);
  assert.ok(event.timestamp);
});

test('buildAuditEvent uses warning level for denied events', () => {
  const event = buildAuditEvent({
    eventName: AUDIT_EVENTS.AUTHORIZATION_DENIED,
    outcome: 'denied',
    requestId: 'request-denied',
    correlationId: 'request-denied',
    actor: {
      authenticated: true,
      userId: 'viewer-123',
      email: 'viewer@example.com',
      roles: ['viewer'],
    },
    action: 'authorize.request',
    method: 'POST',
    path: '/api/v1/workflows/run',
    statusCode: 403,
    errorCode: 'FORBIDDEN',
  });

  assert.equal(event.level, 'warn');
  assert.equal(event.outcome, 'denied');
  assert.equal(event.statusCode, 403);
  assert.deepEqual(event.actor.roles, ['viewer']);
});

test('buildAuditEvent uses error level for failed events', () => {
  const event = buildAuditEvent({
    eventName: AUDIT_EVENTS.WORKFLOW_FAILED,
    outcome: 'failure',
    requestId: 'request-failed',
    correlationId: 'correlation-failed',
    actor: {
      authenticated: true,
      userId: 'admin-123',
      email: 'admin@example.com',
      roles: ['admin'],
    },
    action: 'workflow.run',
    workflowId: 'workflow-failed',
    statusCode: 500,
    errorCode: 'WORKFLOW_FAILED',
  });

  assert.equal(event.level, 'error');
  assert.equal(event.outcome, 'failure');
  assert.equal(event.statusCode, 500);
});

test('audit event structure excludes secret fields', () => {
  const event = buildAuditEvent({
    eventName: AUDIT_EVENTS.REQUEST_STARTED,
    outcome: 'started',
    requestId: 'request-safe',
    correlationId: 'request-safe',
    actor: {
      authenticated: false,
      userId: null,
      email: null,
      roles: [],
    },
    method: 'GET',
    path: '/api/v1/health',
  });

  const serialized = JSON.stringify(event).toLowerCase();

  assert.equal(
    serialized.includes('authorization'),
    false
  );
  assert.equal(
    serialized.includes('access_token'),
    false
  );
  assert.equal(
    serialized.includes('refresh_token'),
    false
  );
  assert.equal(serialized.includes('password'), false);
  assert.equal(serialized.includes('cookie'), false);
  assert.equal(serialized.includes('secret'), false);
});
