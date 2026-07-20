/**
 * Tenant ownership guard for cross-tenant access prevention.
 */

import { recordBelongsToTenant } from './tenant';

export interface TenantGuardContext {
  requestTenantId: string;
  recordTenantId: string | undefined;
  resourceType: string;
  resourceId: string;
}

export interface TenantGuardResult {
  allowed: boolean;
  crossTenantAttempt: boolean;
}

/**
 * Determine whether a resource lookup should proceed for the request tenant.
 *
 * Cross-tenant attempts are denied without leaking record existence.
 */
export function checkTenantOwnership(
  context: TenantGuardContext
): TenantGuardResult {
  const allowed = recordBelongsToTenant(
    context.recordTenantId,
    context.requestTenantId
  );

  return {
    allowed,
    crossTenantAttempt: !allowed && context.recordTenantId !== undefined,
  };
}
