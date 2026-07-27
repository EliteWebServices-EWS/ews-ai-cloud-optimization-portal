/**
 * Bounded API input validation for the Tenant Administration API.
 * Mirrors backend/security/request-validation.ts's conventions.
 */

import { validateRegion } from '../security';
import { AppError } from '../shared/utils';
import type {
  CreateTenantInput,
  UpdateTenantInput,
} from '../repositories/contracts';
import type { TenantPrimaryContact } from '../repositories/models';

const NAME_MAX_LENGTH = 256;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertNonEmptyString(
  value: unknown,
  fieldName: string,
  maxLength = NAME_MAX_LENGTH
): string {
  if (typeof value !== 'string') {
    throw new AppError(
      'INVALID_REQUEST',
      `${fieldName} must be a string.`,
      400,
      'request'
    );
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new AppError(
      'INVALID_REQUEST',
      `${fieldName} is required.`,
      400,
      'request'
    );
  }

  if (trimmed.length > maxLength) {
    throw new AppError(
      'INVALID_REQUEST',
      `${fieldName} exceeds the maximum allowed length.`,
      400,
      'request'
    );
  }

  return trimmed;
}

function assertOptionalString(
  value: unknown,
  fieldName: string,
  maxLength = NAME_MAX_LENGTH
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return assertNonEmptyString(value, fieldName, maxLength);
}

function assertSlug(value: unknown): string {
  const slug = assertNonEmptyString(value, 'slug', 64).toLowerCase();

  if (!SLUG_PATTERN.test(slug)) {
    throw new AppError(
      'INVALID_REQUEST',
      'slug must be lowercase alphanumeric with single internal hyphens.',
      400,
      'request'
    );
  }

  return slug;
}

function assertPrimaryContact(value: unknown): TenantPrimaryContact {
  if (typeof value !== 'object' || value === null) {
    throw new AppError(
      'INVALID_REQUEST',
      'primaryContact is required.',
      400,
      'request'
    );
  }

  const payload = value as Record<string, unknown>;
  const name = assertNonEmptyString(payload.name, 'primaryContact.name');
  const email = assertNonEmptyString(
    payload.email,
    'primaryContact.email',
    256
  );

  if (!EMAIL_PATTERN.test(email)) {
    throw new AppError(
      'INVALID_REQUEST',
      'primaryContact.email must be a valid email address.',
      400,
      'request'
    );
  }

  return { name, email };
}

function assertOptionalMetadata(
  value: unknown
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppError(
      'INVALID_REQUEST',
      'metadata must be an object.',
      400,
      'request'
    );
  }

  return value as Record<string, unknown>;
}

/** Client-asserted optimistic-concurrency version, required on every mutation. */
export function validateExpectedVersion(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    throw new AppError(
      'INVALID_REQUEST',
      'version must be the positive integer version of the tenant being modified.',
      400,
      'request'
    );
  }

  return value;
}

/** Validate a Create Tenant request body. tenantId and status are server-assigned. */
export function validateCreateTenantBody(
  body: unknown
): Omit<CreateTenantInput, 'tenantId' | 'status'> {
  const payload =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};

  return {
    organizationName: assertNonEmptyString(
      payload.organizationName,
      'organizationName'
    ),
    displayName: assertNonEmptyString(payload.displayName, 'displayName'),
    slug: assertSlug(payload.slug),
    ownerUserId: assertNonEmptyString(payload.ownerUserId, 'ownerUserId'),
    primaryContact: assertPrimaryContact(payload.primaryContact),
    region: validateRegion(payload.region),
    subscriptionPlan: assertNonEmptyString(
      payload.subscriptionPlan,
      'subscriptionPlan'
    ),
    metadata: assertOptionalMetadata(payload.metadata),
  };
}

/** Validate an Update Tenant request body. Every field is optional, but at least one is required. */
export function validateUpdateTenantBody(body: unknown): UpdateTenantInput {
  const payload =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};

  const changes: UpdateTenantInput = {
    organizationName: assertOptionalString(
      payload.organizationName,
      'organizationName'
    ),
    displayName: assertOptionalString(payload.displayName, 'displayName'),
    ownerUserId: assertOptionalString(payload.ownerUserId, 'ownerUserId'),
    primaryContact:
      payload.primaryContact === undefined
        ? undefined
        : assertPrimaryContact(payload.primaryContact),
    region:
      payload.region === undefined
        ? undefined
        : validateRegion(payload.region),
    subscriptionPlan: assertOptionalString(
      payload.subscriptionPlan,
      'subscriptionPlan'
    ),
    metadata: assertOptionalMetadata(payload.metadata),
  };

  const hasAnyChange = Object.values(changes).some(
    (value) => value !== undefined
  );

  if (!hasAnyChange) {
    throw new AppError(
      'INVALID_REQUEST',
      'At least one field must be provided to update a tenant.',
      400,
      'request'
    );
  }

  return changes;
}
