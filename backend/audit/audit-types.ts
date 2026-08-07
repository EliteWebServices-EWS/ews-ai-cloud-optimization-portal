import type { SisumRole } from '../auth';
import type { AuditEventName } from './audit-events';

export type AuditOutcome =
  | 'started'
  | 'success'
  | 'failure'
  | 'denied';

export type AuditSource =
  | 'api'
  | 'authorization'
  | 'workflow'
  | 'reporting'
  | 'execution'
  | 'job'
  | 'audit'
  | 'tenant-admin';

export interface AuditActor {
  authenticated: boolean;
  userId: string | null;
  email: string | null;
  roles: SisumRole[];
}

export interface AuditResource {
  type?: string;
  id?: string;
  accountId?: string;
  region?: string;
}

export interface AuditEvent {
  eventId?: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  category: 'audit';
  service: 'sisum-backend';
  environment: string;
  eventName: AuditEventName;
  outcome: AuditOutcome;

  tenantId?: string;
  /** Owning tenant of the requested resource (audit-only; never returned to clients). */
  resourceTenantId?: string;
  schemaVersion?: number;
  source?: AuditSource;
  expiresAt?: number;

  requestId: string;
  correlationId: string;

  actor: AuditActor;

  action?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;

  workflowId?: string;
  reportId?: string;
  executionId?: string;
  /** Correlates asynchronous EC2 job lifecycle events across queue deliveries. */
  jobId?: string;
  /** SQS receive attempt, when the event originated from a queue consumer. */
  attempt?: number;

  resource?: AuditResource;

  reason?: string;
  errorCode?: string;
}

export interface WriteAuditEventInput {
  eventName: AuditEventName;
  outcome: AuditOutcome;

  requestId: string;
  correlationId: string;

  actor: AuditActor;

  /** Trusted tenant from request security context — never from client input. */
  tenantId?: string;
  /** Owning tenant of the requested resource (audit-only; never returned to clients). */
  resourceTenantId?: string;
  source?: AuditSource;

  action?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;

  workflowId?: string;
  reportId?: string;
  executionId?: string;
  jobId?: string;
  attempt?: number;

  resource?: AuditResource;

  reason?: string;
  errorCode?: string;
}
