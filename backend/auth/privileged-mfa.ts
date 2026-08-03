/**
 * Application-level privileged-operation MFA policy.
 *
 * Cognito user-pool access tokens issued after successful TOTP do not reliably
 * include amr / cognito:amr (validated in non-production, 2026-07-28). Those
 * claims MUST NOT be treated as per-session MFA proof.
 *
 * Only MFA_VERIFIED_FOR_CURRENT_SESSION may authorize a privileged operation.
 * That state requires a dedicated trusted access-token claim copied by
 * lambda.ts (see SESSION_MFA_VERIFIED_ACCESS_TOKEN_CLAIM) — not enrollment,
 * groups, scope, or authentication-method references.
 */

import type { AuthenticatedIdentity } from './identity';
import { ADMIN_ROLES, type SisumRole } from './roles';
import { TENANT_ROLES, type TenantRole } from './tenant-roles';
import type { RequestSecurityContext } from './request-security-context';

/** Access-token claim name for approved future session-assurance (Pre Token Gen). */
export const SESSION_MFA_VERIFIED_ACCESS_TOKEN_CLAIM = 'mfa_session_verified';

/**
 * Strict normalization for trusted JWT authorizer boolean claims.
 * Only boolean true and exact lowercase string "true" are accepted.
 */
export function normalizeTrustedBooleanClaim(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * Approved token contract for mfa_session_verified on access tokens.
 * Rejects "TRUE", "false", 1, and other truthy values.
 */
export function isAcceptedSessionMfaVerifiedClaim(value: unknown): boolean {
  return normalizeTrustedBooleanClaim(value);
}

/** MFA assurance states (documentation + policy helpers). */
export const MFA_ASSURANCE_STATE = {
  MFA_CAPABLE: 'MFA_CAPABLE',
  MFA_ENROLLED: 'MFA_ENROLLED',
  MFA_VERIFIED_FOR_CURRENT_SESSION: 'MFA_VERIFIED_FOR_CURRENT_SESSION',
} as const;

export type MfaAssuranceState =
  (typeof MFA_ASSURANCE_STATE)[keyof typeof MFA_ASSURANCE_STATE];

export const PRIVILEGED_OPERATIONS = {
  TENANT_CREATE: 'tenant.create',
  TENANT_ONBOARDING_COMPLETE: 'tenant.onboarding_complete',
  TENANT_DELETE: 'tenant.delete',
  TENANT_SUSPEND: 'tenant.suspend',
  TENANT_REACTIVATE: 'tenant.reactivate',
  TENANT_ARCHIVE: 'tenant.archive',
  TENANT_PRIVILEGED_ROLE_CHANGE: 'membership.privileged_role_change',
  EXECUTION_APPROVE: 'execution.approve',
  EXECUTION_REJECT: 'execution.reject',
  EXECUTION_EXECUTE: 'execution.execute',
  EXECUTION_ROLLBACK: 'execution.rollback',
  AWS_ACCOUNT_REGISTER: 'aws_account.register',
  AWS_ACCOUNT_REMOVE: 'aws_account.remove',
  TENANT_OWNER_BOOTSTRAP: 'tenant.owner_bootstrap',
} as const;

export type PrivilegedOperation =
  (typeof PRIVILEGED_OPERATIONS)[keyof typeof PRIVILEGED_OPERATIONS];

const OPERATIONS_REQUIRING_MFA: ReadonlySet<PrivilegedOperation> = new Set([
  PRIVILEGED_OPERATIONS.TENANT_CREATE,
  PRIVILEGED_OPERATIONS.TENANT_ONBOARDING_COMPLETE,
  PRIVILEGED_OPERATIONS.TENANT_DELETE,
  PRIVILEGED_OPERATIONS.TENANT_SUSPEND,
  PRIVILEGED_OPERATIONS.TENANT_PRIVILEGED_ROLE_CHANGE,
  PRIVILEGED_OPERATIONS.EXECUTION_APPROVE,
  PRIVILEGED_OPERATIONS.EXECUTION_REJECT,
  PRIVILEGED_OPERATIONS.EXECUTION_EXECUTE,
  PRIVILEGED_OPERATIONS.EXECUTION_ROLLBACK,
  PRIVILEGED_OPERATIONS.AWS_ACCOUNT_REGISTER,
  PRIVILEGED_OPERATIONS.AWS_ACCOUNT_REMOVE,
  PRIVILEGED_OPERATIONS.TENANT_OWNER_BOOTSTRAP,
]);

const PRIVILEGED_TENANT_ROLES: ReadonlySet<TenantRole> = new Set([
  TENANT_ROLES.TENANT_OWNER,
  TENANT_ROLES.SECURITY_ADMIN,
]);

export function isPrivilegedTenantRole(role: TenantRole): boolean {
  return PRIVILEGED_TENANT_ROLES.has(role);
}

export function isPlatformAdminRole(roles: readonly SisumRole[]): boolean {
  return roles.some((role) => ADMIN_ROLES.includes(role));
}

export function callerHasPrivilegedTenantMembershipRole(
  membershipRole: TenantRole | undefined,
): boolean {
  return membershipRole !== undefined && isPrivilegedTenantRole(membershipRole);
}

export function operationRequiresMfa(operation: PrivilegedOperation): boolean {
  return OPERATIONS_REQUIRING_MFA.has(operation);
}

/**
 * True only when lambda copied SESSION_MFA_VERIFIED from a validated JWT claim.
 * Never uses amr, cognito:amr, groups, scope, or client headers.
 */
export function hasTrustedSessionMfaEvidence(
  identity: AuthenticatedIdentity,
): boolean {
  return identity.sessionMfaVerified === true;
}

/** @deprecated Use hasTrustedSessionMfaEvidence — amr is not operational MFA proof. */
export function hasTrustedMfaEvidence(identity: AuthenticatedIdentity): boolean {
  return hasTrustedSessionMfaEvidence(identity);
}

export function identityRequiresMfaForOperation(
  context: RequestSecurityContext,
  _identity: AuthenticatedIdentity,
  operation: PrivilegedOperation,
  options?: {
    targetTenantRole?: TenantRole;
    requesterTenantRole?: TenantRole;
  },
): boolean {
  if (!operationRequiresMfa(operation)) {
    return false;
  }

  if (operation === PRIVILEGED_OPERATIONS.TENANT_PRIVILEGED_ROLE_CHANGE) {
    const targetPrivileged = Boolean(
      options?.targetTenantRole &&
        isPrivilegedTenantRole(options.targetTenantRole),
    );
    const requesterPrivileged = Boolean(
      options?.requesterTenantRole &&
        isPrivilegedTenantRole(options.requesterTenantRole),
    );

    return targetPrivileged || requesterPrivileged;
  }

  if (isPlatformAdminRole(context.roles)) {
    return true;
  }

  if (options?.requesterTenantRole && isPrivilegedTenantRole(options.requesterTenantRole)) {
    return true;
  }

  return false;
}

export function evaluatePrivilegedMfa(
  context: RequestSecurityContext,
  identity: AuthenticatedIdentity,
  operation: PrivilegedOperation,
  options?: {
    targetTenantRole?: TenantRole;
    requesterTenantRole?: TenantRole;
  },
): {
  required: boolean;
  satisfied: boolean;
  evidenceUnavailable: boolean;
} {
  const required = identityRequiresMfaForOperation(
    context,
    identity,
    operation,
    options,
  );

  if (!required) {
    return { required: false, satisfied: true, evidenceUnavailable: false };
  }

  const satisfied = hasTrustedSessionMfaEvidence(identity);

  return {
    required: true,
    satisfied,
    evidenceUnavailable: !satisfied,
  };
}
