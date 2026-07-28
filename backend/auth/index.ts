export {
  SISUM_ROLES,
  ALL_AUTHENTICATED_ROLES,
  ANALYSIS_ROLES,
  ADMIN_ROLES,
  isSisumRole,
  type SisumRole,
} from './roles';

export {
  getAuthenticatedIdentity,
  parseGroups,
  parseRawGroups,
  hasRecognizedRole,
  type AuthenticatedIdentity,
} from './identity';

export { requireAnyRole } from './require-role';
export { requireTenantContext } from './require-tenant';
export { requireTenantRole } from './require-tenant-role';

export {
  TENANT_ROLES,
  ALL_TENANT_ROLES,
  MEMBERSHIP_MANAGEMENT_ROLES,
  OWNER_ROLE_ASSIGNMENT_ROLES,
  TENANT_ROLE_TO_SISUM_ROLE,
  isTenantRole,
  sisumRoleSatisfiesTenantRole,
  type TenantRole,
} from './tenant-roles';

export {
  TENANT_ACCESS_TOKEN_CLAIM,
  TENANT_USER_PROFILE_ATTRIBUTE,
  extractTrustedTenantClaim,
} from './tenant-claims';

export {
  TENANT_CLAIM_NAME,
  TenantRequiredError,
  InvalidTenantClaimError,
  resolveTenantEnforcementMode,
  resolveDefaultTenantId,
  resolveTrustedTenantId,
  normalizeRecordTenantId,
  recordBelongsToTenant,
  isTenantFallbackEnabled,
  type TenantEnforcementMode,
  type TenantResolutionResult,
} from './tenant';

export {
  validateTenantId,
  TENANT_ID_PATTERN,
  TENANT_ID_MAX_LENGTH,
  type TenantValidationResult,
} from './tenant-validator';

export {
  buildRequestSecurityContext,
  getRequestSecurityContext,
  attachRequestSecurityContext,
  getAttachedRequestSecurityContext,
  type RequestSecurityContext,
} from './request-security-context';

export {
  checkTenantOwnership,
  type TenantGuardContext,
  type TenantGuardResult,
} from './tenant-guard';

export {
  isPlatformAdministrator,
  isTenantOwner,
  isTenantAdministrator,
  canAdministerTenant,
} from './tenant-admin-authorization';

export {
  PRIVILEGED_OPERATIONS,
  MFA_ASSURANCE_STATE,
  SESSION_MFA_VERIFIED_ACCESS_TOKEN_CLAIM,
  isAcceptedSessionMfaVerifiedClaim,
  evaluatePrivilegedMfa,
  hasTrustedSessionMfaEvidence,
  hasTrustedMfaEvidence,
  identityRequiresMfaForOperation,
  isPrivilegedTenantRole,
  operationRequiresMfa,
  type PrivilegedOperation,
  type MfaAssuranceState,
} from './privileged-mfa';

export {
  stripUntrustedIdentityHeaders,
  stripInternalIdentityHeaders,
  stripSessionMfaVerifiedHeaders,
  INTERNAL_IDENTITY_HEADERS,
  INTERNAL_IDENTITY_HEADER_PREFIX,
} from './internal-identity-headers';

export {
  createIdentitySourceMiddleware,
  resolveIdentitySource,
  type CreateAppIdentityOptions,
  type IdentitySource,
} from './identity-source';

export {
  requirePrivilegedMfa,
  assertPrivilegedRoleChangeMfa,
} from './require-privileged-mfa';