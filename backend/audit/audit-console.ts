import type {
  AuditEvent,
  WriteAuditEventInput,
} from './audit-types';

const DEFAULT_ENVIRONMENT = 'development';

function resolveEnvironment(): string {
  const environment = process.env.ENVIRONMENT?.trim();

  return environment && environment.length > 0
    ? environment
    : DEFAULT_ENVIRONMENT;
}

/**
 * Converts an audit event to one-line JSON suitable for CloudWatch Logs.
 *
 * Do not add request bodies, authorization headers, cookies, passwords,
 * JWTs, AWS credentials, or other secrets to this structure.
 */
export function buildAuditEvent(
  input: WriteAuditEventInput
): AuditEvent {
  let level: AuditEvent['level'];

  if (input.outcome === 'failure') {
    level = 'error';
  } else if (input.outcome === 'denied') {
    level = 'warn';
  } else {
    level = 'info';
  }

  return {
    timestamp: new Date().toISOString(),
    level,
    category: 'audit',
    service: 'sisum-backend',
    environment: resolveEnvironment(),

    ...input,
  };
}

export function logAuditEventToConsole(
  event: AuditEvent
): AuditEvent {
  const serializedEvent = JSON.stringify(event);

  if (event.level === 'error') {
    console.error(serializedEvent);
  } else if (event.level === 'warn') {
    console.warn(serializedEvent);
  } else {
    console.info(serializedEvent);
  }

  return event;
}
