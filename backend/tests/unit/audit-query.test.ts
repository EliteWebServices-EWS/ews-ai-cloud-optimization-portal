import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AuditQueryValidationError,
  DEFAULT_AUDIT_QUERY_LIMIT,
  MAX_AUDIT_QUERY_LIMIT,
  parseAuditQueryFilters,
} from '../../audit';

const tenantId = 'sisum-default';

test('parseAuditQueryFilters applies defaults and limit cap', () => {
  const filters = parseAuditQueryFilters({}, tenantId);

  assert.equal(filters.tenantId, tenantId);
  assert.equal(filters.limit, DEFAULT_AUDIT_QUERY_LIMIT);
});

test('parseAuditQueryFilters enforces maximum page size', () => {
  const filters = parseAuditQueryFilters(
    { limit: '500' },
    tenantId
  );

  assert.equal(filters.limit, MAX_AUDIT_QUERY_LIMIT);
});

test('parseAuditQueryFilters accepts supported filters', () => {
  const filters = parseAuditQueryFilters(
    {
      eventName: 'workflow.completed',
      outcome: 'success',
      actorUserId: 'admin-123',
      workflowId: 'wf-123',
      requestId: 'req-123',
      correlationId: 'corr-123',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-19T23:59:59.000Z',
      limit: '25',
      nextToken: 'dG9rZW4',
    },
    tenantId
  );

  assert.equal(filters.eventName, 'workflow.completed');
  assert.equal(filters.outcome, 'success');
  assert.equal(filters.actorUserId, 'admin-123');
  assert.equal(filters.workflowId, 'wf-123');
  assert.equal(filters.requestId, 'req-123');
  assert.equal(filters.correlationId, 'corr-123');
  assert.equal(filters.from, '2026-07-01T00:00:00.000Z');
  assert.equal(filters.to, '2026-07-19T23:59:59.000Z');
  assert.equal(filters.limit, 25);
  assert.equal(filters.nextToken, 'dG9rZW4');
});

test('parseAuditQueryFilters rejects invalid timestamps', () => {
  assert.throws(
    () =>
      parseAuditQueryFilters(
        { from: 'not-a-date' },
        tenantId
      ),
    (error: unknown) => {
      assert.ok(error instanceof AuditQueryValidationError);
      assert.equal(error.code, 'INVALID_FROM');
      return true;
    }
  );
});

test('parseAuditQueryFilters rejects inverted time ranges', () => {
  assert.throws(
    () =>
      parseAuditQueryFilters(
        {
          from: '2026-07-19T12:00:00.000Z',
          to: '2026-07-01T00:00:00.000Z',
        },
        tenantId
      ),
    (error: unknown) => {
      assert.ok(error instanceof AuditQueryValidationError);
      assert.equal(error.code, 'INVALID_RANGE');
      return true;
    }
  );
});

test('parseAuditQueryFilters rejects unsafe identifier characters', () => {
  assert.throws(
    () =>
      parseAuditQueryFilters(
        { actorUserId: 'bad actor' },
        tenantId
      ),
    (error: unknown) => {
      assert.ok(error instanceof AuditQueryValidationError);
      assert.equal(error.code, 'INVALID_FILTER');
      return true;
    }
  );
});
