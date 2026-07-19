export {
  AUDIT_EVENTS,
  type AuditEventName,
} from './audit-events';

export {
  buildAuditEvent,
  writeAuditEvent,
  writeAuditEventFromBuilt,
} from './audit-logger';

export {
  getAuditActor,
  getCorrelationId,
  getRequestId,
} from './request-context';

export {
  auditPersistenceFlushMiddleware,
  getPendingAuditWrites,
  scheduleAuditPersistence,
} from './audit-persistence-context';

export {
  isAuditPersistenceEnabled,
  shouldPersistAuditEvent,
  getAuditRepository,
  setAuditRepository,
  resetAuditRepository,
  enrichAuditEventForPersistence,
  logPersistenceFailure,
  persistAuditEvent,
  queryAuditEvents,
  AuditPersistenceUnavailableError,
} from './audit-service';

export {
  AUDIT_SCHEMA_VERSION,
  DEFAULT_AUDIT_RETENTION_DAYS,
  MAX_AUDIT_QUERY_LIMIT,
  DEFAULT_AUDIT_QUERY_LIMIT,
  DEFAULT_TENANT_ID,
  calculateAuditExpiresAt,
  resolveRetentionDays,
  buildAuditPartitionKey,
  buildAuditSortKey,
  inferAuditSource,
  toAuditRecord,
  toDynamoDbItem,
  fromDynamoDbItem,
  parseAuditQueryFilters,
  AuditQueryValidationError,
  type AuditQueryFilters,
  type AuditRecord,
  type AuditQueryResult,
} from './audit-query';

export {
  DynamoDbAuditRepository,
  buildAuditPartitionKeyForTest,
  buildAuditSortKeyForTest,
} from './dynamodb-audit-repository';

export type { AuditRepository } from './audit-repository';

export {
  DEFAULT_TENANT_ID as TENANT_DEFAULT_ID,
  resolveTenantId,
} from './tenant-context';

export type {
  AuditActor,
  AuditEvent,
  AuditOutcome,
  AuditResource,
  AuditSource,
  WriteAuditEventInput,
} from './audit-types';
