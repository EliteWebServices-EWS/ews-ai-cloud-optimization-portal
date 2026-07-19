import { randomUUID } from 'node:crypto';
import { AUDIT_EVENTS, type AuditEventName } from './audit-events';
import type { AuditRepository } from './audit-repository';
import {
  AUDIT_SCHEMA_VERSION,
  calculateAuditExpiresAt,
  inferAuditSource,
  type AuditQueryFilters,
  type AuditQueryResult,
} from './audit-query';
import { DynamoDbAuditRepository } from './dynamodb-audit-repository';
import type { AuditEvent } from './audit-types';
import { resolveTenantId } from './tenant-context';

const NON_PERSISTED_EVENTS = new Set<AuditEventName>([
  AUDIT_EVENTS.REQUEST_STARTED,
  AUDIT_EVENTS.REQUEST_COMPLETED,
  AUDIT_EVENTS.AUDIT_SEARCH_PERFORMED,
]);

export function isAuditPersistenceEnabled(): boolean {
  const configured =
    process.env.AUDIT_PERSISTENCE_ENABLED
      ?.trim()
      .toLowerCase();

  if (configured === 'false') {
    return false;
  }

  return true;
}

export function shouldPersistAuditEvent(
  eventName: AuditEventName
): boolean {
  return !NON_PERSISTED_EVENTS.has(eventName);
}

let repositoryInstance: AuditRepository | null = null;

export function getAuditRepository(): AuditRepository | null {
  if (!isAuditPersistenceEnabled()) {
    return null;
  }

  const tableName =
    process.env.AUDIT_TABLE_NAME?.trim();

  if (!tableName) {
    return null;
  }

  if (!repositoryInstance) {
    repositoryInstance = new DynamoDbAuditRepository({
      tableName,
    });
  }

  return repositoryInstance;
}

export function setAuditRepository(
  repository: AuditRepository | null
): void {
  repositoryInstance = repository;
}

export function resetAuditRepository(): void {
  repositoryInstance = null;
}

export function enrichAuditEventForPersistence(
  event: AuditEvent
): AuditEvent {
  const tenantId =
    event.tenantId ??
    resolveTenantId(event.actor);

  return {
    ...event,
    eventId: event.eventId ?? randomUUID(),
    tenantId,
    schemaVersion:
      event.schemaVersion ?? AUDIT_SCHEMA_VERSION,
    source:
      event.source ??
      inferAuditSource(event.eventName),
    expiresAt:
      event.expiresAt ??
      calculateAuditExpiresAt(event.timestamp),
  };
}

export interface PersistenceFailureContext {
  event: AuditEvent;
  error: unknown;
}

export function logPersistenceFailure(
  context: PersistenceFailureContext
): void {
  const message =
    context.error instanceof Error
      ? context.error.message
      : 'Unknown audit persistence failure';

  const failureEvent = {
    timestamp: new Date().toISOString(),
    level: 'error' as const,
    category: 'audit' as const,
    service: 'sisum-backend',
    environment: context.event.environment,
    eventName: AUDIT_EVENTS.AUDIT_PERSISTENCE_FAILED,
    outcome: 'failure' as const,
    requestId: context.event.requestId,
    correlationId: context.event.correlationId,
    actor: context.event.actor,
    action: 'audit.persist',
    reason: message,
    errorCode: 'AUDIT_PERSISTENCE_FAILED',
    failedEventName: context.event.eventName,
    failedEventId: context.event.eventId,
    tenantId: context.event.tenantId,
  };

  console.error(JSON.stringify(failureEvent));
}

export async function persistAuditEvent(
  event: AuditEvent
): Promise<void> {
  if (!shouldPersistAuditEvent(event.eventName)) {
    return;
  }

  const repository = getAuditRepository();

  if (!repository) {
    return;
  }

  const enriched = enrichAuditEventForPersistence(event);

  try {
    await repository.save(enriched);
  } catch (error) {
    logPersistenceFailure({ event: enriched, error });
  }
}

export async function queryAuditEvents(
  filters: AuditQueryFilters
): Promise<AuditQueryResult> {
  const repository = getAuditRepository();

  if (!repository) {
    throw new AuditPersistenceUnavailableError();
  }

  return repository.query(filters);
}

export class AuditPersistenceUnavailableError extends Error {
  constructor() {
    super(
      'Audit persistence is disabled or not configured.'
    );
    this.name = 'AuditPersistenceUnavailableError';
  }
}
