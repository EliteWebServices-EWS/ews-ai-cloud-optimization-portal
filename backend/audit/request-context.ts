import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { getAuthenticatedIdentity } from '../auth';
import type { AuditActor } from './audit-types';

const REQUEST_ID_HEADER = 'x-request-id';
const CORRELATION_ID_HEADER = 'x-correlation-id';

function normalizeIdentifier(value: string | undefined): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  /*
   * Prevent extremely large or malformed client values from being copied
   * into logs. Request identifiers are metadata, not arbitrary user input.
   */
  return normalized.slice(0, 128);
}

export function getRequestId(req: Request): string {
  const existingRequestId = normalizeIdentifier(
    req.header(REQUEST_ID_HEADER)
  );

  return existingRequestId ?? randomUUID();
}

export function getCorrelationId(
  req: Request,
  requestId: string
): string {
  const existingCorrelationId = normalizeIdentifier(
    req.header(CORRELATION_ID_HEADER)
  );

  return existingCorrelationId ?? requestId;
}

export function getAuditActor(req: Request): AuditActor {
  const identity = getAuthenticatedIdentity(req);

  return {
    authenticated: identity.authenticated,
    userId: identity.userId,
    email: identity.email,
    roles: identity.groups,
  };
}