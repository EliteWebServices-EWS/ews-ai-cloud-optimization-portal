import type { WriteAuditEventInput } from '../audit/audit-types';
import type { AuditEventName } from '../audit/audit-events';

export const EXECUTION_RUN_AUDIT_RESOURCE_TYPE = 'execution-run';

export interface ExecutionApiAuditPayloadInput {
  eventName: AuditEventName;
  outcome: 'success' | 'failure' | 'started' | 'denied';
  requestId: string;
  correlationId: string;
  actor: WriteAuditEventInput['actor'];
  tenantId: string;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  /** Execution plan ID (stored as audit executionId). */
  planId?: string;
  /** Workflow that owns the execution plan. */
  workflowId?: string;
  /** Adapter execution run ID (stored on audit resource, not workflowId). */
  runId?: string;
  runRegion?: string;
  errorCode?: string;
  reason?: string;
}

/**
 * Builds audit write input for execution API routes.
 *
 * executionId always refers to the execution plan ID. workflowId always refers
 * to the optimization workflow ID. Execution run IDs are stored on resource.id.
 */
export function buildExecutionApiAuditInput(
  input: ExecutionApiAuditPayloadInput,
): WriteAuditEventInput {
  const writeInput: WriteAuditEventInput = {
    eventName: input.eventName,
    outcome: input.outcome,
    requestId: input.requestId,
    correlationId: input.correlationId,
    actor: input.actor,
    tenantId: input.tenantId,
    action: input.action,
    method: input.method,
    path: input.path,
    statusCode: input.statusCode,
    executionId: input.planId,
    workflowId: input.workflowId,
    errorCode: input.errorCode,
    reason: input.reason,
  };

  if (input.runId) {
    writeInput.resource = {
      type: EXECUTION_RUN_AUDIT_RESOURCE_TYPE,
      id: input.runId,
      ...(input.runRegion ? { region: input.runRegion } : {}),
    };
  }

  return writeInput;
}
