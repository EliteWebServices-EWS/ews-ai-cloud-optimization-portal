import {
  AWS_ACCOUNT_METADATA_MAX_DEPTH,
  AWS_ACCOUNT_METADATA_MAX_KEYS,
  InvalidAwsAccountRecordError,
  validateAwsAccountId,
  validateAwsAccountRegion,
  validateAwsAccountRoleArn,
} from '../repositories/models/aws-account-persistence-models';
import { AppError } from '../shared/utils';

export class AwsAccountApiValidationError extends AppError {
  constructor(message: string) {
    super('INVALID_REQUEST', message, 422, 'aws-account-api');
    this.name = 'AwsAccountApiValidationError';
  }
}

function assertPlainObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AwsAccountApiValidationError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function countMetadataKeys(value: Record<string, unknown>, depth = 0): number {
  if (depth > AWS_ACCOUNT_METADATA_MAX_DEPTH) {
    throw new AwsAccountApiValidationError('metadata exceeds maximum nesting depth.');
  }
  const entries = Object.entries(value);
  let total = entries.length;
  for (const [, entryValue] of entries) {
    if (entryValue !== null && typeof entryValue === 'object' && !Array.isArray(entryValue)) {
      total += countMetadataKeys(entryValue as Record<string, unknown>, depth + 1);
    }
  }
  return total;
}

/**
 * Light client-side pre-check only — the repository layer's
 * validateAwsAccountShape (via validateAwsAccountShape inside
 * MockAwsAccountRepository / DynamoDbAwsAccountRepository) is the
 * authoritative validator and enforces the same key-count/depth/type
 * rules server-side regardless of what this function lets through.
 */
function validateMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const metadata = assertPlainObject(value, 'metadata');
  if (countMetadataKeys(metadata) > AWS_ACCOUNT_METADATA_MAX_KEYS) {
    throw new AwsAccountApiValidationError('metadata exceeds maximum key count.');
  }
  return metadata;
}

function requireNonEmptyStringField(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new AwsAccountApiValidationError(`${field} is required.`);
  }
  return value.trim();
}

function rethrowModelError(error: unknown): never {
  if (error instanceof InvalidAwsAccountRecordError) {
    throw new AwsAccountApiValidationError(error.message);
  }
  throw error;
}

export interface RegisterAwsAccountBody {
  accountId: string;
  roleArn: string;
  region: string;
  metadata?: Record<string, unknown>;
}

/**
 * Validates the body of POST /aws-accounts (Register AWS account).
 *
 * `accountId` is the tenant's own 12-digit AWS account number — they
 * already know it, so it's client-supplied (unlike an internal record
 * id). tenantId, externalId, status, and verificationStatus are never
 * accepted from the client: tenantId comes from the trusted request
 * context; externalId is generated server-side so it can never be
 * spoofed by the caller; status/verificationStatus always start at
 * their initial lifecycle values.
 *
 * Global uniqueness of accountId (one AWS account can only ever be
 * connected to one tenant platform-wide) is enforced by the repository,
 * not here — see AwsAccountRepository.create().
 */
export function validateRegisterAwsAccountBody(body: unknown): RegisterAwsAccountBody {
  const input = assertPlainObject(body, 'body');

  for (const forbiddenField of [
    'tenantId',
    'externalId',
    'status',
    'verificationStatus',
  ] as const) {
    if (input[forbiddenField] !== undefined) {
      throw new AwsAccountApiValidationError(
        `${forbiddenField} must not be supplied in the request body.`,
      );
    }
  }

  const rawAccountId = requireNonEmptyStringField(input, 'accountId');
  const rawRoleArn = requireNonEmptyStringField(input, 'roleArn');
  const rawRegion = requireNonEmptyStringField(input, 'region');

  let accountId: string;
  let roleArn: string;
  let region: string;
  try {
    accountId = validateAwsAccountId(rawAccountId);
    roleArn = validateAwsAccountRoleArn(rawRoleArn, accountId);
    region = validateAwsAccountRegion(rawRegion);
  } catch (error) {
    rethrowModelError(error);
  }

  return {
    accountId,
    roleArn,
    region,
    metadata: validateMetadata(input.metadata),
  };
}

export interface UpdateAwsAccountConfigurationBody {
  region?: string;
  metadata?: Record<string, unknown>;
  expectedVersion: number;
}

/** Validates the body of PATCH /aws-accounts/{accountId} (Update configuration). */
export function validateUpdateAwsAccountBody(body: unknown): UpdateAwsAccountConfigurationBody {
  const input = assertPlainObject(body, 'body');

  for (const forbiddenField of [
    'tenantId',
    'accountId',
    'roleArn',
    'externalId',
    'status',
    'verificationStatus',
  ] as const) {
    if (input[forbiddenField] !== undefined) {
      throw new AwsAccountApiValidationError(
        `${forbiddenField} cannot be changed through this endpoint.`,
      );
    }
  }

  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new AwsAccountApiValidationError('expectedVersion must be a positive integer.');
  }

  let region: string | undefined;
  if (input.region !== undefined) {
    if (typeof input.region !== 'string') {
      throw new AwsAccountApiValidationError('region must be a string when provided.');
    }
    try {
      region = validateAwsAccountRegion(input.region);
    } catch (error) {
      rethrowModelError(error);
    }
  }

  return {
    expectedVersion,
    region,
    metadata: validateMetadata(input.metadata),
  };
}

export function validateExpectedVersionQuery(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AwsAccountApiValidationError('expectedVersion must be a positive integer.');
  }
  return parsed;
}

/** Validates the body of POST /aws-accounts/{accountId}/verify. */
export function validateVerifyAwsAccountBody(body: unknown): { expectedVersion: number } {
  const input = assertPlainObject(body, 'body');
  return { expectedVersion: validateExpectedVersionQuery(input.expectedVersion) };
}

/** Validates the body of DELETE /aws-accounts/{accountId}. */
export function validateDeleteAwsAccountBody(body: unknown): { expectedVersion: number } {
  const input = assertPlainObject(body ?? {}, 'body');
  return { expectedVersion: validateExpectedVersionQuery(input.expectedVersion) };
}
