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