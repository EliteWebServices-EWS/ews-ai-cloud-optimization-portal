import {
  AUDIT_EVENTS,
  type AuditEventName,
} from './audit-events';
import { buildAuditEvent, logAuditEventToConsole } from './audit-console';
import type { AuditActor, AuditEvent, AuditOutcome } from './audit-types';

export type Ec2JobAuditEvent =
  | 'queued'
  | 'started'
  | 'retry'
  | 'partial'
  | 'failed'
  | 'completed'
  | 'dlq_moved'
  | 'redrive_completed';

export interface Ec2JobAuditContext {
  jobId: string;
  requestId: string;
  correlationId: string;
  actor?: AuditActor;
  tenantId?: string;
  accountId?: string;
  region?: string;
  attempt?: number;
  reason?: string;
  errorCode?: string;
}

const SERVICE_ACTOR: AuditActor = {
  authenticated: true,
  userId: 'ec2-job-worker',
  email: null,
  roles: [],
};

const EVENT_NAMES: Record<Ec2JobAuditEvent, AuditEventName> = {
  queued: AUDIT_EVENTS.EC2_JOB_QUEUED,
  started: AUDIT_EVENTS.EC2_JOB_STARTED,
  retry: AUDIT_EVENTS.EC2_JOB_RETRY,
  partial: AUDIT_EVENTS.EC2_JOB_PARTIAL,
  failed: AUDIT_EVENTS.EC2_JOB_FAILED,
  completed: AUDIT_EVENTS.EC2_JOB_COMPLETED,
  dlq_moved: AUDIT_EVENTS.EC2_JOB_DLQ_MOVED,
  redrive_completed: AUDIT_EVENTS.EC2_JOB_REDRIVE_COMPLETED,
};

const OUTCOMES: Record<Ec2JobAuditEvent, AuditOutcome> = {
  queued: 'started',
  started: 'started',
  retry: 'started',
  partial: 'success',
  failed: 'failure',
  completed: 'success',
  dlq_moved: 'failure',
  redrive_completed: 'success',
};

/**
 * Emits the canonical structured audit record for the EC2 asynchronous job
 * lifecycle.  The record deliberately excludes job payloads and credentials.
 */
export function writeEc2JobAuditEvent(
  event: Ec2JobAuditEvent,
  context: Ec2JobAuditContext,
): AuditEvent {
  return logAuditEventToConsole(buildAuditEvent({
    eventName: EVENT_NAMES[event],
    outcome: OUTCOMES[event],
    requestId: context.requestId,
    correlationId: context.correlationId,
    actor: context.actor ?? SERVICE_ACTOR,
    tenantId: context.tenantId,
    source: 'job',
    action: `ec2.job.${event}`,
    jobId: context.jobId,
    attempt: context.attempt,
    resource: {
      type: 'ec2-job',
      id: context.jobId,
      accountId: context.accountId,
      region: context.region,
    },
    reason: context.reason,
    errorCode: context.errorCode,
  }));
}
