import type { AuditEventName } from './audit-events';
import type {
  AuditEvent,
  AuditOutcome,
  AuditSource,
} from './audit-types';
import { DEFAULT_TENANT_ID } from './tenant-context';

export { DEFAULT_TENANT_ID };

export const AUDIT_SCHEMA_VERSION = 1;
export const DEFAULT_AUDIT_RETENTION_DAYS = 365;
export const MAX_AUDIT_QUERY_LIMIT = 100;
export const DEFAULT_AUDIT_QUERY_LIMIT = 50;

export interface AuditQueryFilters {
  tenantId: string;
  eventName?: AuditEventName;
  outcome?: AuditOutcome;
  actorUserId?: string;
  workflowId?: string;
  requestId?: string;
  correlationId?: string;
  from?: string;
  to?: string;
  limit: number;
  nextToken?: string;
}

export interface AuditRecord {
  eventId: string;
  timestamp: string;
  eventName: AuditEventName;
  outcome: AuditOutcome;
  level: AuditEvent['level'];
  actorUserId: string | null;
  actorEmail: string | null;
  actorRoles: string[];
  requestId: string;
  correlationId: string;
  workflowId?: string;
  reportId?: string;
  executionId?: string;
  action?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  resourceType?: string;
  resourceId?: string;
  region?: string;
  reason?: string;
  errorCode?: string;
  schemaVersion: number;
  expiresAt: number;
  tenantId: string;
  source?: AuditSource;
  environment: string;
}

export interface AuditQueryResult {
  items: AuditRecord[];
  nextToken?: string;
}

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function parsePositiveInteger(
  value: unknown,
  fallback: number,
  max: number
): number {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function normalizeOptionalString(
  value: unknown,
  maxLength = 128
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.slice(0, maxLength);
}

function isValidIsoTimestamp(value: string): boolean {
  if (!ISO_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }

  return !Number.isNaN(Date.parse(value));
}

export function calculateAuditExpiresAt(
  timestampIso: string,
  retentionDays = resolveRetentionDays()
): number {
  const timestampMs = Date.parse(timestampIso);
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

  return Math.floor((timestampMs + retentionMs) / 1000);
}

export function resolveRetentionDays(): number {
  const configured = Number.parseInt(
    process.env.AUDIT_RETENTION_DAYS ?? '',
    10
  );

  if (
    Number.isFinite(configured) &&
    configured > 0
  ) {
    return configured;
  }

  return DEFAULT_AUDIT_RETENTION_DAYS;
}

export function buildAuditPartitionKey(
  tenantId: string
): string {
  return `TENANT#${tenantId}`;
}

export function buildAuditSortKey(
  timestampIso: string,
  eventId: string
): string {
  return `AUDIT#${timestampIso}#${eventId}`;
}

export function inferAuditSource(
  eventName: AuditEventName
): AuditSource {
  if (eventName.startsWith('authorization.') ||
      eventName.startsWith('identity.') ||
      eventName.startsWith('role.') ||
      eventName.startsWith('tenant.')) {
    return 'authorization';
  }

  if (eventName.startsWith('workflow.')) {
    return 'workflow';
  }

  if (eventName.startsWith('report.')) {
    return 'reporting';
  }

  if (eventName.startsWith('execution.')) {
    return 'execution';
  }

  if (eventName.startsWith('audit.')) {
    return 'audit';
  }

  return 'api';
}

export function toAuditRecord(
  event: AuditEvent
): AuditRecord {
  if (!event.eventId) {
    throw new Error(
      'Audit eventId is required before persistence.'
    );
  }

  return {
    eventId: event.eventId,
    timestamp: event.timestamp,
    eventName: event.eventName,
    outcome: event.outcome,
    level: event.level,
    actorUserId: event.actor.userId,
    actorEmail: event.actor.email,
    actorRoles: [...event.actor.roles],
    requestId: event.requestId,
    correlationId: event.correlationId,
    workflowId: event.workflowId,
    reportId: event.reportId,
    executionId: event.executionId,
    action: event.action,
    method: event.method,
    path: event.path,
    statusCode: event.statusCode,
    durationMs: event.durationMs,
    resourceType: event.resource?.type,
    resourceId: event.resource?.id,
    region: event.resource?.region,
    reason: event.reason,
    errorCode: event.errorCode,
    schemaVersion: event.schemaVersion ?? AUDIT_SCHEMA_VERSION,
    expiresAt:
      event.expiresAt ??
      calculateAuditExpiresAt(event.timestamp),
    tenantId: event.tenantId ?? DEFAULT_TENANT_ID,
    source: event.source,
    environment: event.environment,
  };
}

export function toDynamoDbItem(
  record: AuditRecord
): Record<string, unknown> {
  return {
    pk: buildAuditPartitionKey(record.tenantId),
    sk: buildAuditSortKey(
      record.timestamp,
      record.eventId
    ),
    eventId: record.eventId,
    timestamp: record.timestamp,
    eventName: record.eventName,
    outcome: record.outcome,
    level: record.level,
    actorUserId: record.actorUserId,
    actorEmail: record.actorEmail,
    actorRoles: record.actorRoles,
    requestId: record.requestId,
    correlationId: record.correlationId,
    workflowId: record.workflowId,
    reportId: record.reportId,
    executionId: record.executionId,
    action: record.action,
    method: record.method,
    path: record.path,
    statusCode: record.statusCode,
    durationMs: record.durationMs,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    region: record.region,
    reason: record.reason,
    errorCode: record.errorCode,
    schemaVersion: record.schemaVersion,
    expiresAt: record.expiresAt,
    tenantId: record.tenantId,
    source: record.source,
    environment: record.environment,
  };
}

export function fromDynamoDbItem(
  item: Record<string, unknown>
): AuditRecord {
  return {
    eventId: String(item.eventId),
    timestamp: String(item.timestamp),
    eventName: item.eventName as AuditEventName,
    outcome: item.outcome as AuditOutcome,
    level: item.level as AuditEvent['level'],
    actorUserId:
      typeof item.actorUserId === 'string'
        ? item.actorUserId
        : null,
    actorEmail:
      typeof item.actorEmail === 'string'
        ? item.actorEmail
        : null,
    actorRoles: Array.isArray(item.actorRoles)
      ? item.actorRoles.map(String)
      : [],
    requestId: String(item.requestId),
    correlationId: String(item.correlationId),
    workflowId:
      typeof item.workflowId === 'string'
        ? item.workflowId
        : undefined,
    reportId:
      typeof item.reportId === 'string'
        ? item.reportId
        : undefined,
    executionId:
      typeof item.executionId === 'string'
        ? item.executionId
        : undefined,
    action:
      typeof item.action === 'string'
        ? item.action
        : undefined,
    method:
      typeof item.method === 'string'
        ? item.method
        : undefined,
    path:
      typeof item.path === 'string'
        ? item.path
        : undefined,
    statusCode:
      typeof item.statusCode === 'number'
        ? item.statusCode
        : undefined,
    durationMs:
      typeof item.durationMs === 'number'
        ? item.durationMs
        : undefined,
    resourceType:
      typeof item.resourceType === 'string'
        ? item.resourceType
        : undefined,
    resourceId:
      typeof item.resourceId === 'string'
        ? item.resourceId
        : undefined,
    region:
      typeof item.region === 'string'
        ? item.region
        : undefined,
    reason:
      typeof item.reason === 'string'
        ? item.reason
        : undefined,
    errorCode:
      typeof item.errorCode === 'string'
        ? item.errorCode
        : undefined,
    schemaVersion:
      typeof item.schemaVersion === 'number'
        ? item.schemaVersion
        : AUDIT_SCHEMA_VERSION,
    expiresAt: Number(item.expiresAt),
    tenantId: String(item.tenantId),
    source:
      typeof item.source === 'string'
        ? (item.source as AuditSource)
        : undefined,
    environment: String(item.environment),
  };
}

export function parseAuditQueryFilters(
  query: Record<string, unknown>,
  tenantId: string
): AuditQueryFilters {
  if (
    typeof query.tenantId === 'string' &&
    query.tenantId.trim().length > 0
  ) {
    throw new AuditQueryValidationError(
      'TENANT_QUERY_FORBIDDEN',
      'tenantId query parameter is not accepted. Audit queries are scoped to the authenticated tenant.'
    );
  }

  const eventName = normalizeOptionalString(
    query.eventName,
    64
  ) as AuditEventName | undefined;

  const outcome = normalizeOptionalString(
    query.outcome,
    16
  ) as AuditOutcome | undefined;

  const actorUserId = normalizeOptionalString(
    query.actorUserId
  );

  const workflowId = normalizeOptionalString(
    query.workflowId
  );

  const requestId = normalizeOptionalString(
    query.requestId
  );

  const correlationId = normalizeOptionalString(
    query.correlationId
  );

  const from = normalizeOptionalString(query.from, 32);
  const to = normalizeOptionalString(query.to, 32);
  const nextToken = normalizeOptionalString(
    query.nextToken,
    2048
  );

  const limit = parsePositiveInteger(
    query.limit,
    DEFAULT_AUDIT_QUERY_LIMIT,
    MAX_AUDIT_QUERY_LIMIT
  );

  if (from && !isValidIsoTimestamp(from)) {
    throw new AuditQueryValidationError(
      'INVALID_FROM',
      'from must be a valid ISO-8601 UTC timestamp.'
    );
  }

  if (to && !isValidIsoTimestamp(to)) {
    throw new AuditQueryValidationError(
      'INVALID_TO',
      'to must be a valid ISO-8601 UTC timestamp.'
    );
  }

  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new AuditQueryValidationError(
      'INVALID_RANGE',
      'from must be earlier than or equal to to.'
    );
  }

  for (const [field, value] of [
    ['actorUserId', actorUserId],
    ['workflowId', workflowId],
    ['requestId', requestId],
    ['correlationId', correlationId],
  ] as const) {
    if (value && !IDENTIFIER_PATTERN.test(value)) {
      throw new AuditQueryValidationError(
        'INVALID_FILTER',
        `${field} contains unsupported characters.`
      );
    }
  }

  return {
    tenantId,
    eventName,
    outcome,
    actorUserId,
    workflowId,
    requestId,
    correlationId,
    from,
    to,
    limit,
    nextToken,
  };
}

export class AuditQueryValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AuditQueryValidationError';
    this.code = code;
  }
}
