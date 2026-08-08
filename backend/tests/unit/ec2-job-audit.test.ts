import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AUDIT_EVENTS, writeEc2JobAuditEvent } from '../../audit';

describe('EC2 job audit events', () => {
  it('records every asynchronous job lifecycle transition with safe correlation data', () => {
    const expected = [
      ['queued', AUDIT_EVENTS.EC2_JOB_QUEUED, 'started'],
      ['started', AUDIT_EVENTS.EC2_JOB_STARTED, 'started'],
      ['retry', AUDIT_EVENTS.EC2_JOB_RETRY, 'started'],
      ['partial', AUDIT_EVENTS.EC2_JOB_PARTIAL, 'success'],
      ['failed', AUDIT_EVENTS.EC2_JOB_FAILED, 'failure'],
      ['completed', AUDIT_EVENTS.EC2_JOB_COMPLETED, 'success'],
      ['dlq_moved', AUDIT_EVENTS.EC2_JOB_DLQ_MOVED, 'failure'],
      ['redrive_completed', AUDIT_EVENTS.EC2_JOB_REDRIVE_COMPLETED, 'success'],
    ] as const;

    for (const [transition, eventName, outcome] of expected) {
      const event = writeEc2JobAuditEvent(transition, {
        jobId: 'job-123',
        requestId: 'request-123',
        correlationId: 'correlation-123',
        tenantId: 'tenant-123',
        accountId: '111122223333',
        region: 'us-east-1',
        attempt: 2,
      });

      assert.equal(event.eventName, eventName);
      assert.equal(event.outcome, outcome);
      assert.equal(event.source, 'job');
      assert.equal(event.jobId, 'job-123');
      assert.equal(event.attempt, 2);
      assert.deepEqual(event.resource, {
        type: 'ec2-job', id: 'job-123', accountId: '111122223333', region: 'us-east-1',
      });
    }
  });
});
