import type { SisumRole } from '../auth';
import type { AuditEventName } from './audit-events';

export type AuditOutcome =
  | 'started'
  | 'success'
  | 'failure'
  | 'denied';

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
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  category: 'audit';
  service: 'sisum-backend';
  environment: string;
  eventName: AuditEventName;
  outcome: AuditOutcome;

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

  action?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;

  workflowId?: string;
  reportId?: string;
  executionId?: string;

  resource?: AuditResource;

  reason?: string;
  errorCode?: string;
}