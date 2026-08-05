import type { WriteAuditEventInput } from '../audit/audit-types';
import type { AuditEventName } from '../audit/audit-events';

export const COST_FINDING_AUDIT_RESOURCE_TYPE = 'cost-finding';
export const COST_ANALYSIS_AUDIT_RESOURCE_TYPE = 'cost-analysis';

export interface CostIntelligenceApiAuditPayloadInput {
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
  accountId?: string;
  analysisId?: string;
  findingId?: string;
  region?: string;
  errorCode?: string;
  reason?: string;
}

/** Builds audit write input for EC2 cost intelligence API routes. */
export function buildCostIntelligenceApiAuditInput(
  input: CostIntelligenceApiAuditPayloadInput,
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
    errorCode: input.errorCode,
    reason: input.reason,
  };

  const resourceId = input.findingId ?? input.analysisId;
  if (resourceId) {
    writeInput.resource = {
      type: input.findingId
        ? COST_FINDING_AUDIT_RESOURCE_TYPE
        : COST_ANALYSIS_AUDIT_RESOURCE_TYPE,
      id: resourceId,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.region ? { region: input.region } : {}),
    };
  }

  return writeInput;
}
