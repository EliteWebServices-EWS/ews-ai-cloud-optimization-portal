/**
 * Reads API Gateway-validated identity details from internal request headers.
 *
 * These headers are created by backend/lambda.ts after API Gateway validates
 * the Cognito access token. Client-supplied versions are removed and replaced
 * before the event reaches Express.
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
  tokenUse: string | null;
  clientId: string | null;
}

function parseGroups(rawGroups: string | undefined): SisumRole[] {
  if (!rawGroups) {
    return [];
  }

  const normalized = rawGroups
    .trim()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/"/g, '');

  return normalized
    .split(',')
    .map((group) => group.trim())
    .filter(isSisumRole);
}

export function getAuthenticatedIdentity(
  req: Request
): AuthenticatedIdentity {
  return {
    authenticated:
      req.header('x-sisum-authenticated') === 'true',

    userId:
      req.header('x-sisum-user-id') ?? null,

    email:
      req.header('x-sisum-user-email') ?? null,

    groups:
      parseGroups(req.header('x-sisum-user-groups')),

    tokenUse:
      req.header('x-sisum-token-use') ?? null,

    clientId:
      req.header('x-sisum-client-id') ?? null,
  };
}