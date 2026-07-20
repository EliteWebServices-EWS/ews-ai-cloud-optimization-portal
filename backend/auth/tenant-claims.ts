/**
 * Trusted tenant claim names for Cognito access tokens.
 *
 * Cognito user-pool custom attributes (custom:tenantId) are stored on the user
 * profile but are NOT included in access tokens automatically. A Pre Token
 * Generation V2_0 Lambda injects the normalized tenant_id access-token claim.
 *
 * @see infrastructure/auth/template.yaml (SisumPreTokenGenerationFunction ZipFile)
 */

/** Claim injected into access tokens by the Pre Token Generation trigger. */
export const TENANT_ACCESS_TOKEN_CLAIM = 'tenant_id';

/** Administrator-assigned Cognito user profile attribute. */
export const TENANT_USER_PROFILE_ATTRIBUTE = 'custom:tenantId';

/**
 * Extract the trusted tenant claim from API Gateway JWT authorizer claims.
 *
 * Only tenant_id is accepted from access tokens. custom:tenantId is not read
 * from access tokens because Cognito does not place user-pool custom attributes
 * there without a Pre Token Generation trigger — and even then the injected
 * claim name is tenant_id.
 */
export function extractTrustedTenantClaim(
  claims: Record<string, string | undefined>
): string | null {
  const tenantId = claims[TENANT_ACCESS_TOKEN_CLAIM]?.trim();

  if (!tenantId) {
    return null;
  }

  return tenantId;
}
