import type { TenantRecordIdentity } from '../repositories/contracts/repository-types';

export const ACTION_LOG_EVENT_VERSION = 1;

export const ACTION_LOG_EVENT_TYPES = [
  'RECOMMENDATION_OBSERVED',
  'PERSISTENCE_EVALUATED',
  'MATURITY_EVALUATED',
  'GOVERNANCE_EVALUATED',
  'CONFIDENCE_EVALUATED',
  'DECISION_READINESS_EVALUATED',
  'ML_ELIGIBILITY_EVALUATED',
  'ML_EXECUTED',
  'ML_SKIPPED',
  'ML_FAILED_SAFE',
  'RECOMMENDATION_DECIDED',
  'APPROVAL_REQUIRED',
  'APPROVAL_GRANTED',
  'APPROVAL_REJECTED',
  'APPROVAL_OVERRIDDEN',
  'EXECUTION_STARTED',
  'EXECUTION_SUCCEEDED',
  'EXECUTION_FAILED',
  'EXECUTION_SIMULATED',
  'VERIFICATION_STARTED',
  'VERIFICATION_COMPLETED',
  'VERIFICATION_INSUFFICIENT_EVIDENCE',
] as const;

export type ActionLogEventType = (typeof ACTION_LOG_EVENT_TYPES)[number];

export const ACTION_LOG_SOURCE_STAGES = [
  'RECOMMENDATION',
  'PERSISTENCE',
  'MATURITY',
  'GOVERNANCE',
  'CONFIDENCE',
  'DECISION_READINESS',
  'ML',
  'APPROVAL',
  'EXECUTION',
  'VERIFICATION',
] as const;

export type ActionLogSourceStage = (typeof ACTION_LOG_SOURCE_STAGES)[number];

/**
 * Append-only longitudinal decision lifecycle event.
 * Stores durable references — not full upstream payloads.
 */
export interface ActionLogRecord extends TenantRecordIdentity {
  /**
   * Stored ActionLog row identity. In v1 this intentionally equals
   * {@link logicalEventId} because canonical and projection rows share one
   * stable logical occurrence identity.
   */
  eventId: string;
  /** Logical domain lifecycle occurrence identity (idempotency key). */
  logicalEventId: string;
  accountId?: string;
  resourceId?: string;
  findingKey?: string;
  decisionId?: string;
  workflowId?: string;
  jobId?: string;
  correlationId: string;
  executionId?: string;
  eventType: ActionLogEventType;
  eventVersion: number;
  sourceStage: ActionLogSourceStage;
  sourceRecordId: string;
  sourceRecordVersion?: string;
  /** Optional ML model identity — provenance metadata, not a reason code. */
  modelId?: string;
  /** Optional ML feature schema version — provenance metadata, not a reason code. */
  featureSchemaVersion?: string;
  reasonCodes?: readonly string[];
  actorType?: string;
  actorId?: string;
  /** Domain event time — never rewritten on late arrival. */
  occurredAt: string;
  /** Persistence time — when ActionLog stored the event. */
  recordedAt: string;
  /** Deterministic tie-breaker for same {@link occurredAt}. */
  orderKey: string;
}

export interface RecordActionLogEventInput {
  tenantId: string;
  accountId?: string;
  resourceId?: string;
  findingKey?: string;
  decisionId?: string;
  workflowId?: string;
  jobId?: string;
  correlationId: string;
  executionId?: string;
  eventType: ActionLogEventType;
  eventVersion?: number;
  sourceStage: ActionLogSourceStage;
  sourceRecordId: string;
  sourceRecordVersion?: string;
  /** Optional ML model identity — provenance metadata, not a reason code. */
  modelId?: string;
  /** Optional ML feature schema version — provenance metadata, not a reason code. */
  featureSchemaVersion?: string;
  reasonCodes?: readonly string[];
  actorType?: string;
  actorId?: string;
  occurredAt: string;
  recordedAt?: string;
  /** Caller-supplied stable identity preferred for idempotency. */
  logicalEventId?: string;
}

export interface RecordActionLogEventResult {
  event: ActionLogRecord;
  created: boolean;
}

export class ActionLogValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionLogValidationError';
  }
}

function assertNonEmpty(value: string | undefined, fieldName: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new ActionLogValidationError(`${fieldName} is required.`);
  }
  return normalized;
}

function assertIsoTimestamp(value: string, fieldName: string): string {
  const normalized = assertNonEmpty(value, fieldName);
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    throw new ActionLogValidationError(`${fieldName} must be a valid ISO-8601 timestamp.`);
  }
  return normalized;
}

function assertJsonSerializable(value: unknown, fieldName: string): void {
  try {
    JSON.stringify(value);
  } catch {
    throw new ActionLogValidationError(`${fieldName} must be JSON serializable.`);
  }
}

export function validateRecordActionLogEventInput(
  input: RecordActionLogEventInput,
): RecordActionLogEventInput {
  const tenantId = assertNonEmpty(input.tenantId, 'tenantId');
  const correlationId = assertNonEmpty(input.correlationId, 'correlationId');
  const eventType = input.eventType;
  if (!ACTION_LOG_EVENT_TYPES.includes(eventType)) {
    throw new ActionLogValidationError(`Unsupported eventType: ${String(eventType)}.`);
  }
  const sourceStage = input.sourceStage;
  if (!ACTION_LOG_SOURCE_STAGES.includes(sourceStage)) {
    throw new ActionLogValidationError(`Unsupported sourceStage: ${String(sourceStage)}.`);
  }
  const sourceRecordId = assertNonEmpty(input.sourceRecordId, 'sourceRecordId');
  const occurredAt = assertIsoTimestamp(input.occurredAt, 'occurredAt');
  const recordedAt = input.recordedAt
    ? assertIsoTimestamp(input.recordedAt, 'recordedAt')
    : undefined;

  if (input.accountId !== undefined) {
    assertNonEmpty(input.accountId, 'accountId');
  }
  if (input.resourceId !== undefined) {
    assertNonEmpty(input.resourceId, 'resourceId');
    assertNonEmpty(input.accountId, 'accountId');
  }
  if (input.reasonCodes !== undefined) {
    assertJsonSerializable(input.reasonCodes, 'reasonCodes');
  }
  if (input.modelId !== undefined) {
    assertNonEmpty(input.modelId, 'modelId');
  }
  if (input.featureSchemaVersion !== undefined) {
    assertNonEmpty(input.featureSchemaVersion, 'featureSchemaVersion');
  }

  return {
    ...input,
    tenantId,
    correlationId,
    sourceRecordId,
    occurredAt,
    recordedAt,
    eventVersion: input.eventVersion ?? ACTION_LOG_EVENT_VERSION,
  };
}

export function toActionLogRecord(input: RecordActionLogEventInput & {
  logicalEventId: string;
  orderKey: string;
  recordedAt: string;
}): ActionLogRecord {
  return {
    eventId: input.logicalEventId,
    logicalEventId: input.logicalEventId,
    tenantId: input.tenantId,
    accountId: input.accountId,
    resourceId: input.resourceId,
    findingKey: input.findingKey,
    decisionId: input.decisionId,
    workflowId: input.workflowId,
    jobId: input.jobId,
    correlationId: input.correlationId,
    executionId: input.executionId,
    eventType: input.eventType,
    eventVersion: input.eventVersion ?? ACTION_LOG_EVENT_VERSION,
    sourceStage: input.sourceStage,
    sourceRecordId: input.sourceRecordId,
    sourceRecordVersion: input.sourceRecordVersion,
    modelId: input.modelId,
    featureSchemaVersion: input.featureSchemaVersion,
    reasonCodes: input.reasonCodes,
    actorType: input.actorType,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    recordedAt: input.recordedAt,
    orderKey: input.orderKey,
  };
}
