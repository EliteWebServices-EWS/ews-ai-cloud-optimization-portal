/**
 * Trusted tenant resolution from authenticated identity claims.
 *
 * Never accept tenant identifiers from request body, query string, route
 * parameters, or arbitrary client headers.
 */

import { DEFAULT_TENANT_ID } from '../audit/tenant-context';
import type { AuthenticatedIdentity } from './identity';
import { validateTenantId } from './tenant-validator';
import {
  TENANT_ACCESS_TOKEN_CLAIM,
  TENANT_USER_PROFILE_ATTRIBUTE,
} from './tenant-claims';

export type TenantEnforcementMode = 'strict' | 'compatibility';

/** @deprecated Use TENANT_ACCESS_TOKEN_CLAIM — kept for documentation references. */
export const TENANT_CLAIM_NAME = TENANT_ACCESS_TOKEN_CLAIM;

/** Cognito user profile attribute assigned by administrators. */
export { TENANT_USER_PROFILE_ATTRIBUTE };

export interface TenantResolutionResult {
  tenantId: string;
  claimPresent: boolean;
  usedFallback: boolean;
  invalidClaim: boolean;
}

export class TenantRequiredError extends Error {
  readonly code = 'TENANT_REQUIRED';

  constructor(message = 'A trusted tenant claim is required.') {
    super(message);
    this.name = 'TenantRequiredError';
  }
}

export class InvalidTenantClaimError extends Error {
  readonly code = 'INVALID_TENANT_CLAIM';

  constructor(message = 'The trusted tenant claim is invalid.') {
    super(message);
    this.name = 'InvalidTenantClaimError';
  }
}

/**
 * Resolve configured tenant enforcement mode.
 *
 * Default: compatibility — allows users without tenant_id access-token claim.
 * Enable strict before onboarding external customers.
 */
export function resolveTenantEnforcementMode(): TenantEnforcementMode {
  const configured = process.env.TENANT_ENFORCEMENT_MODE?.trim().toLowerCase();

  if (configured === 'strict') {
    return 'strict';
  }

  return 'compatibility';
}

/**
 * Resolve configured fallback tenant identifier.
 */
export function resolveDefaultTenantId(): string {
  const configured = process.env.DEFAULT_TENANT_ID?.trim();
  const candidate = configured && configured.length > 0
    ? configured
    : DEFAULT_TENANT_ID;

  const validation = validateTenantId(candidate);

  if (!validation.valid || !validation.normalized) {
    return DEFAULT_TENANT_ID;
  }

  return validation.normalized;
}

/**
 * Determine whether fallback to DEFAULT_TENANT_ID is permitted.
 */
export function isTenantFallbackEnabled(): boolean {
  const enforcementMode = resolveTenantEnforcementMode();

  if (enforcementMode === 'strict') {
    return process.env.TENANT_FALLBACK_ENABLED?.trim().toLowerCase() === 'true';
  }

  return true;
}

/**
 * Resolve the trusted tenant identifier for an authenticated request.
 */
export function resolveTrustedTenantId(
  identity: AuthenticatedIdentity
): TenantResolutionResult {
  const claimValue = identity.tenantId;
  const enforcementMode = resolveTenantEnforcementMode();

  if (claimValue) {
    const validation = validateTenantId(claimValue);

    if (!validation.valid || !validation.normalized) {
      if (enforcementMode === 'strict') {
        throw new InvalidTenantClaimError(validation.reason);
      }

      return {
        tenantId: resolveDefaultTenantId(),
        claimPresent: true,
        usedFallback: true,
        invalidClaim: true,
      };
    }

    return {
      tenantId: validation.normalized,
      claimPresent: true,
      usedFallback: false,
      invalidClaim: false,
    };
  }

  if (enforcementMode === 'strict' && !isTenantFallbackEnabled()) {
    throw new TenantRequiredError();
  }

  if (!isTenantFallbackEnabled()) {
    throw new TenantRequiredError();
  }

  return {
    tenantId: resolveDefaultTenantId(),
    claimPresent: false,
    usedFallback: true,
    invalidClaim: false,
  };
}

/**
 * Normalize tenant ownership on legacy records without tenantId.
 *
 * Only applies during compatibility mode — strict mode rejects legacy records.
 */
export function normalizeRecordTenantId(
  recordTenantId: string | undefined
): string | null {
  if (recordTenantId) {
    const validation = validateTenantId(recordTenantId);
    return validation.valid ? validation.normalized : null;
  }

  if (resolveTenantEnforcementMode() === 'compatibility') {
    return resolveDefaultTenantId();
  }

  return null;
}

/**
 * Check whether a stored record belongs to the requesting tenant.
 */
export function recordBelongsToTenant(
  recordTenantId: string | undefined,
  requestTenantId: string
): boolean {
  const normalized = normalizeRecordTenantId(recordTenantId);

  if (!normalized) {
    return false;
  }

  return normalized === requestTenantId;
}
