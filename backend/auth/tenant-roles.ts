/**
 * Tenant membership roles.
 *
 * These are finer-grained, per-tenant roles assigned to a user's
 * TenantMembership record (see repositories/models/persistence-models.ts).
 * They are distinct from — but integrate with — the coarse-grained Cognito
 * group roles in ./roles.ts that gate API access at the platform level.
 *
 * Integration model:
 *  - `requireAnyRole(...)` (Cognito groups) continues to gate whether an
 *    authenticated identity may call an endpoint at all.
 *  - `requireTenantRole(...)` (this file, via require-tenant-role.ts) gates
 *    whether the caller's *tenant membership* record grants the specific
 *    tenant-scoped permission the action requires.
 *  - TENANT_ROLE_TO_SISUM_ROLE documents/enforces the minimum Cognito group
 *    each tenant role implies, so a membership role can never grant more
 *    platform-level access than the identity's own Cognito groups allow.
 */

import { SISUM_ROLES, type SisumRole } from './roles';

export const TENANT_ROLES = {
  TENANT_OWNER: 'tenant_owner',
  TENANT_ADMIN: 'tenant_admin',
  SECURITY_ADMIN: 'security_admin',
  ANALYST: 'analyst',
  VIEWER: 'viewer',
  AUDITOR: 'auditor',
} as const;

export type TenantRole = (typeof TENANT_ROLES)[keyof typeof TENANT_ROLES];

export const ALL_TENANT_ROLES: readonly TenantRole[] = [
  TENANT_ROLES.TENANT_OWNER,
  TENANT_ROLES.TENANT_ADMIN,
  TENANT_ROLES.SECURITY_ADMIN,
  TENANT_ROLES.ANALYST,
  TENANT_ROLES.VIEWER,
  TENANT_ROLES.AUDITOR,
];

export function isTenantRole(value: string): value is TenantRole {
  return (ALL_TENANT_ROLES as readonly string[]).includes(value);
}

/**
 * Roles permitted to manage tenant membership: invite, assign roles,
 * suspend/reactivate, and remove members. Tenant Owner and Tenant Admin
 * are the only roles trusted with membership administration; Security
 * Admin can manage security posture but not membership itself.
 */
export const MEMBERSHIP_MANAGEMENT_ROLES: readonly TenantRole[] = [
  TENANT_ROLES.TENANT_OWNER,
  TENANT_ROLES.TENANT_ADMIN,
];

/**
 * Only the Tenant Owner role may transfer or assign the Tenant Owner role
 * itself, preventing privilege escalation by a Tenant Admin.
 */
export const OWNER_ROLE_ASSIGNMENT_ROLES: readonly TenantRole[] = [
  TENANT_ROLES.TENANT_OWNER,
];

/**
 * Minimum Cognito/platform role (see ./roles.ts) implied by each tenant
 * membership role. Used to keep the two role systems consistent: a tenant
 * role can never be exercised by an identity whose Cognito groups don't
 * meet this floor.
 */
export const TENANT_ROLE_TO_SISUM_ROLE: Record<TenantRole, SisumRole> = {
  [TENANT_ROLES.TENANT_OWNER]: SISUM_ROLES.ADMIN,
  [TENANT_ROLES.TENANT_ADMIN]: SISUM_ROLES.ADMIN,
  [TENANT_ROLES.SECURITY_ADMIN]: SISUM_ROLES.ADMIN,
  [TENANT_ROLES.ANALYST]: SISUM_ROLES.ANALYST,
  [TENANT_ROLES.VIEWER]: SISUM_ROLES.VIEWER,
  [TENANT_ROLES.AUDITOR]: SISUM_ROLES.VIEWER,
};

/**
 * True when an identity holding `identityRole` (Cognito group) is
 * permitted to exercise a tenant membership role of `tenantRole`.
 */
export function sisumRoleSatisfiesTenantRole(
  identityRoles: readonly SisumRole[],
  tenantRole: TenantRole,
): boolean {
  const required = TENANT_ROLE_TO_SISUM_ROLE[tenantRole];

  if (required === SISUM_ROLES.VIEWER) {
    return identityRoles.length > 0;
  }

  if (required === SISUM_ROLES.ANALYST) {
    return identityRoles.some(
      (role) => role === SISUM_ROLES.ANALYST || role === SISUM_ROLES.ADMIN,
    );
  }

  return identityRoles.includes(SISUM_ROLES.ADMIN);
}
