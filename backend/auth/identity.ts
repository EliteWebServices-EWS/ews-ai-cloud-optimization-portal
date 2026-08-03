/**
 * Reads API Gateway-validated identity details from internal request headers.
 *
 * These headers are created by backend/lambda.ts after API Gateway validates
 * the Cognito access token. On direct HTTP, createApp({ identitySource: 'direct-http' })
 * strips all x-sisum-* headers before handlers run; client-supplied values are never trusted.
 */

import type { Request } from 'express';
import {
  isSisumRole,
  type SisumRole,
} from './roles';

export interface AuthenticatedIdentity {
  authenticated: boolean;
  userId: string | null;
  email: string | null;
  groups: SisumRole[];
  rawGroups: string[];
  tokenUse: string | null;
  clientId: string | null;
  /** Trusted tenant_id access-token claim — never from client headers or body. */
  tenantId: string | null;
  /**
   * Current-session MFA completed — true only when lambda sets the internal
   * header after API Gateway validated JWT claim mfa_session_verified is
   * boolean true or exact string "true".
   * Not read from body, query, cookies, or client-facing request fields.
   */
  sessionMfaVerified?: boolean;
}

function normalizeClaim(value: string | undefined): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed;
}

export function parseRawGroups(
  rawGroups: string | undefined
): string[] {
  if (!rawGroups) {
    return [];
  }

  const normalized = rawGroups
    .trim()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/"/g, '');

  if (normalized.length === 0) {
    return [];
  }

  return normalized
    .split(',')
    .map((group) => group.trim())
    .filter((group) => group.length > 0);
}

export function parseGroups(rawGroups: string | undefined): SisumRole[] {
  return parseRawGroups(rawGroups).filter(isSisumRole);
}

export function hasRecognizedRole(groups: SisumRole[]): boolean {
  return groups.length > 0;
}

export function getAuthenticatedIdentity(
  req: Request
): AuthenticatedIdentity {
  const rawGroupHeader = req.header('x-sisum-user-groups');
  const rawGroups = parseRawGroups(rawGroupHeader ?? undefined);

  return {
    authenticated:
      req.header('x-sisum-authenticated') === 'true',

    userId:
      normalizeClaim(req.header('x-sisum-user-id')),

    email:
      normalizeClaim(req.header('x-sisum-user-email')),

    groups:
      rawGroups.filter(isSisumRole),

    rawGroups,

    tokenUse:
      normalizeClaim(req.header('x-sisum-token-use')),

    clientId:
      normalizeClaim(req.header('x-sisum-client-id')),

    tenantId:
      normalizeClaim(req.header('x-sisum-tenant-id')),

    sessionMfaVerified:
      req.header('x-sisum-mfa-session-verified') === 'true',
  };
}
