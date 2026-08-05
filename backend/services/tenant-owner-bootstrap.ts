/**
 * Tenant eligibility rules for one-time owner bootstrap.
 */

import type { TenantRecord } from '../repositories/models';
import { AppError } from '../shared/utils';

/** Only ACTIVE registry tenants may bootstrap; JWT tenant_id alone is insufficient. */
export function assertTenantEligibleForOwnerBootstrap(
  tenant: TenantRecord | undefined,
): void {
  if (!tenant || tenant.status === 'DELETED') {
    throw new AppError(
      'NOT_FOUND',
      'Tenant not found.',
      404,
      'tenant-bootstrap',
    );
  }

  if (tenant.status !== 'ACTIVE') {
    throw new AppError(
      'TENANT_NOT_BOOTSTRAPPABLE',
      'Tenant owner bootstrap is only allowed for active tenants.',
      409,
      'tenant-bootstrap',
    );
  }
}

/** App error codes mapped to owner_bootstrap_denied audit (not failure). */
export const TENANT_OWNER_BOOTSTRAP_DENIED_CODES = new Set([
  'TENANT_OWNER_ALREADY_BOOTSTRAPPED',
  'TENANT_NOT_BOOTSTRAPPABLE',
  'NOT_FOUND',
]);
