import type { WriteAuditEventInput } from '../audit/audit-types';
import type { AuditEventName } from '../audit/audit-events';

export const AWS_ACCOUNT_AUDIT_RESOURCE_TYPE = 'aws-account';

export interface AwsAccountApiAuditPayloadInput {
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
  /** The customer's 12-digit AWS account number — safe to log (not a secret). */
  accountId?: string;
  discoveredAccountId?: string;
  organizationId?: string;
  enabledRegionCount?: number;
  warningCodes?: string[];
  region?: string;
  errorCode?: string;
  reason?: string;
}

/**
 * Builds audit write input for AWS account API routes.
 *
 * Deliberately never accepts roleArn or externalId: the role ARN is
 * low-sensitivity but not useful for audit search, and the external ID is
 * a shared secret used to prevent confused-deputy AssumeRole attacks —
 * it must never be written to logs or the audit trail.
 */
export function buildAwsAccountApiAuditInput(
  input: AwsAccountApiAuditPayloadInput,
): WriteAuditEventInput {
  return {
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
    resource: input.accountId
      ? {
          type: AWS_ACCOUNT_AUDIT_RESOURCE_TYPE,
          id: input.accountId,
          accountId: input.accountId,
          ...(input.discoveredAccountId
            ? { discoveredAccountId: input.discoveredAccountId }
            : {}),
          ...(input.organizationId ? { organizationId: input.organizationId } : {}),
          ...(input.enabledRegionCount !== undefined
            ? { enabledRegionCount: input.enabledRegionCount }
            : {}),
          ...(input.warningCodes?.length
            ? { warningCodes: input.warningCodes.join(',') }
            : {}),
          ...(input.region ? { region: input.region } : {}),
        }
      : undefined,
  };
}
