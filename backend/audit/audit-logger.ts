import type {
  AuditEvent,
  WriteAuditEventInput,
} from './audit-types';
import {
  buildAuditEvent,
  logAuditEventToConsole,
} from './audit-console';

export { buildAuditEvent } from './audit-console';

/**
 * Writes a structured audit event to CloudWatch via console output.
 *
 * DynamoDB persistence is scheduled separately through
 * {@link writeAuditEventWithPersistence} when a request context is available.
 */
export function writeAuditEvent(
  input: WriteAuditEventInput
): AuditEvent {
  const event = buildAuditEvent(input);

  return logAuditEventToConsole(event);
}

export function writeAuditEventFromBuilt(
  event: AuditEvent
): AuditEvent {
  return logAuditEventToConsole(event);
}
