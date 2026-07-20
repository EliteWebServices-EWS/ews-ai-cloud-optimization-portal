/**
 * Canonical tenant identifier validation.
 *
 * Tenant IDs are lowercase alphanumeric with hyphens, 1–64 characters,
 * and must start and end with a letter or digit.
 */

export const TENANT_ID_PATTERN =
  /^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,62}[a-z0-9])$/;

export const TENANT_ID_MAX_LENGTH = 64;

export interface TenantValidationResult {
  valid: boolean;
  normalized: string | null;
  reason?: string;
}

/**
 * Validate and normalize a tenant identifier.
 *
 * Trusted Cognito claims are not silently lowercased — invalid casing is
 * rejected so production identifiers remain authoritative.
 */
export function validateTenantId(
  value: string | null | undefined
): TenantValidationResult {
  if (value === null || value === undefined) {
    return {
      valid: false,
      normalized: null,
      reason: 'Tenant identifier is required.',
    };
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return {
      valid: false,
      normalized: null,
      reason: 'Tenant identifier cannot be empty.',
    };
  }

  if (trimmed.length > TENANT_ID_MAX_LENGTH) {
    return {
      valid: false,
      normalized: null,
      reason: `Tenant identifier exceeds ${TENANT_ID_MAX_LENGTH} characters.`,
    };
  }

  if (!TENANT_ID_PATTERN.test(trimmed)) {
    return {
      valid: false,
      normalized: null,
      reason:
        'Tenant identifier must contain only lowercase letters, numbers, and hyphens.',
    };
  }

  return {
    valid: true,
    normalized: trimmed,
  };
}
