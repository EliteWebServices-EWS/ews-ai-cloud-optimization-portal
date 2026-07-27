/**
 * Authorization for the Tenant Administration API.
 *
 * Only three actors may administer a tenant:
 *
 *  - Platform Admin: holds the existing "admin" SISUM RBAC role
 *    (ADMIN_ROLES). Platform-wide — may administer any tenant, exactly
 *    like the existing admin-only audit-search endpoint.
 *  - Tenant Owner: the trusted request identity's userId matches the
 *    target tenant's ownerUserId (data-driven, no RBAC role needed).
 *  - Tenant Admin: an "admin"-role user whose own trusted tenant_id claim
 *    matches the target tenant. There is no dedicated per-tenant admin
 *    membership yet (planned for Sprint 12's tenant/identity
 *    administration expansion) — this approximates it by reusing the two
 *    Cognito claims that already exist (cognito:groups and tenant_id)
 *    instead of inventing new infrastructure this sprint has no mandate
 *    to build. In practice this overlaps with Platform Admin today; the
 *    distinction becomes meaningful once tenant-scoped admin membership
 *    lands.
 *
 * Every check here is scoped to a specific tenant. There is deliberately
 * no "is this user an administrator in general" helper — administration
 * authorization only ever makes sense against a target tenant (or, for
 * platform-wide actions like Create Tenant and List Tenants, against the
 * Platform Admin role alone).
 */

import { ADMIN_ROLES } from './roles';
import type { RequestSecurityContext } from './request-security-context';
import type { TenantRecord } from '../repositories/models';

export function isPlatformAdministrator(
  context: RequestSecurityContext
): boolean {
  return context.roles.some((role) => ADMIN_ROLES.includes(role));
}

export function isTenantOwner(
  context: RequestSecurityContext,
  tenant: TenantRecord
): boolean {
  return context.userId !== null && context.userId === tenant.ownerUserId;
}

export function isTenantAdministrator(
  context: RequestSecurityContext,
  tenant: TenantRecord
): boolean {
  return (
    isPlatformAdministrator(context) && context.tenantId === tenant.tenantId
  );
}

/** True if the caller may administer this specific, already-loaded tenant. */
export function canAdministerTenant(
  context: RequestSecurityContext,
  tenant: TenantRecord
): boolean {
  return (
    isPlatformAdministrator(context) ||
    isTenantOwner(context, tenant) ||
    isTenantAdministrator(context, tenant)
  );
}
