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

  REPORT_GENERATED: 'report.generated',
  REPORT_GENERATION_FAILED: 'report.generation_failed',

  EXECUTION_SIMULATED: 'execution.simulated',
  EXECUTION_SIMULATION_FAILED: 'execution.simulation_failed',
} as const;

export type AuditEventName =
  (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];