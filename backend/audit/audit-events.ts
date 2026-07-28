/**
 * Standard audit event names used across the SISU'M backend.
 *
 * Keep event names stable because CloudWatch Logs Insights queries,
 * alarms, dashboards, and future persistence may depend on them.
 */
export const AUDIT_EVENTS = {
  REQUEST_STARTED: 'request.started',
  REQUEST_COMPLETED: 'request.completed',
  REQUEST_FAILED: 'request.failed',
  AUTHORIZATION_DENIED: 'authorization.denied',
  IDENTITY_MISSING: 'identity.missing',
  ROLE_UNRECOGNIZED: 'role.unrecognized',
  WORKFLOW_STARTED: 'workflow.started',
  WORKFLOW_COMPLETED: 'workflow.completed',
  WORKFLOW_FAILED: 'workflow.failed',
  WORKFLOW_DUPLICATE_DETECTED: 'workflow.duplicate_detected',
  REPORT_GENERATED: 'report.generated',
  REPORT_GENERATION_FAILED: 'report.generation_failed',
  EXECUTION_SIMULATED: 'execution.simulated',
  EXECUTION_SIMULATION_FAILED: 'execution.simulation_failed',
  AUDIT_SEARCH_PERFORMED: 'audit.search_performed',
  AUDIT_PERSISTENCE_FAILED: 'audit.persistence_failed',
  TENANT_CLAIM_MISSING: 'tenant.claim_missing',
  TENANT_FALLBACK_USED: 'tenant.fallback_used',
  TENANT_ACCESS_DENIED: 'tenant.access_denied',
  
  MEMBER_ADDED: 'member.added',
  MEMBER_UPDATED: 'member.updated',
  MEMBER_SUSPENDED: 'member.suspended',
  MEMBER_REACTIVATED: 'member.reactivated',
  MEMBER_REMOVED: 'member.removed',
  MEMBER_ACTION_FAILED: 'member.action_failed',
  INVITATION_CREATED: 'invitation.created',
  INVITATION_ACCEPTED: 'invitation.accepted',
  INVITATION_CANCELLED: 'invitation.cancelled',
  INVITATION_ACTION_FAILED: 'invitation.action_failed',

  TENANT_CREATED: 'tenant.created',
  TENANT_UPDATED: 'tenant.updated',
  TENANT_SUSPENDED: 'tenant.suspended',
  TENANT_REACTIVATED: 'tenant.reactivated',
  TENANT_ARCHIVED: 'tenant.archived',
  TENANT_DELETED: 'tenant.deleted',
  TENANT_ADMINISTRATION_DENIED: 'tenant.administration_denied',
  PRIVILEGED_MFA_REQUIRED: 'privileged.mfa_required',
  PRIVILEGED_MFA_VERIFIED: 'privileged.mfa_verified',
  PRIVILEGED_MFA_DENIED: 'privileged.mfa_denied',
} as const;
export type AuditEventName =
  (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];
