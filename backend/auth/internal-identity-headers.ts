/**
 * Internal identity headers copied by backend/lambda.ts from API Gateway JWT claims.
 * Must never be trusted on direct HTTP unless identitySource is lambda-adapter.
 */

/** Prefix for adapter-populated trusted identity headers. */
export const INTERNAL_IDENTITY_HEADER_PREFIX = 'x-sisum-';

/**
 * Canonical internal identity headers (lowercase). Additional x-sisum-* names
 * are still stripped in direct-http mode.
 */
export const INTERNAL_IDENTITY_HEADERS = [
  'x-sisum-authenticated',
  'x-sisum-user-id',
  'x-sisum-user-email',
  'x-sisum-user-groups',
  'x-sisum-token-use',
  'x-sisum-client-id',
  'x-sisum-tenant-id',
  'x-sisum-mfa-session-verified',
  'x-sisum-auth-methods',
] as const;

/** Legacy client spoof headers removed by the Lambda adapter. */
export const LEGACY_IDENTITY_SPOOF_HEADERS = [
  'x-tenant-id',
  'x-mfa-verified',
  'x-auth-method',
  'x-amr',
] as const;

export function isInternalIdentityHeaderName(headerName: string): boolean {
  return headerName.toLowerCase().startsWith(INTERNAL_IDENTITY_HEADER_PREFIX);
}

export function stripInternalIdentityHeaders(
  headers: Record<string, string | string[] | undefined>,
): void {
  for (const key of Object.keys(headers)) {
    if (isInternalIdentityHeaderName(key)) {
      delete headers[key];
    }
  }
}

export function stripLegacyIdentitySpoofHeaders(
  headers: Record<string, string | string[] | undefined>,
): void {
  for (const key of Object.keys(headers)) {
    if (
      LEGACY_IDENTITY_SPOOF_HEADERS.includes(
        key.toLowerCase() as (typeof LEGACY_IDENTITY_SPOOF_HEADERS)[number],
      )
    ) {
      delete headers[key];
    }
  }
}

/** Remove caller-supplied identity headers before direct HTTP handling. */
export function stripUntrustedIdentityHeaders(
  headers: Record<string, string | string[] | undefined>,
): void {
  stripInternalIdentityHeaders(headers);
  stripLegacyIdentitySpoofHeaders(headers);
}

const SESSION_MFA_HEADER_CANONICAL = 'x-sisum-mfa-session-verified';

/** Remove client-supplied session MFA headers (any header name casing). */
export function stripSessionMfaVerifiedHeaders(
  headers: Record<string, string | undefined>,
): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === SESSION_MFA_HEADER_CANONICAL) {
      delete headers[key];
    }
  }
}
