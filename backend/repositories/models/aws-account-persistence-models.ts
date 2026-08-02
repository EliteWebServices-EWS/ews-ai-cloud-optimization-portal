import { validateTenantId } from '../../auth/tenant-validator';

export const AWS_ACCOUNT_ID_PATTERN = /^\d{12}$/;

export const AWS_REGION_PATTERN = /^[a-z]{2}(?:-[a-z]+)+-\d+$/;

export const IAM_ROLE_ARN_PATTERN =
  /^arn:aws:iam::(\d{12}):role\/[\w+=,.@-]+$/;

export const AWS_ACCOUNT_METADATA_MAX_KEYS = 32;
export const AWS_ACCOUNT_METADATA_MAX_DEPTH = 4;
export const AWS_ACCOUNT_METADATA_MAX_ARRAY_LENGTH = 64;
export const AWS_ACCOUNT_EXTERNAL_ID_MAX_LENGTH = 256;

export type AwsAccountStatus =
  | 'PENDING'
  | 'VALIDATING'
  | 'VERIFIED'
  | 'SUSPENDED'
  | 'DELETED';

export type AwsAccountVerificationStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'SUCCEEDED'
  | 'FAILED';

export interface AwsAccountRecord {
  accountId: string;
  tenantId: string;
  roleArn: string;
  externalId: string;
  region: string;
  status: AwsAccountStatus;
  verificationStatus: AwsAccountVerificationStatus;
  lastValidated?: string;
  metadata: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export class InvalidAwsAccountRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAwsAccountRecordError';
  }
}

function assertIsoTimestamp(value: string, fieldName: string): void {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new InvalidAwsAccountRecordError(
      `${fieldName} must be a valid ISO timestamp.`,
    );
  }
}

function validateMetadataValue(
  entryValue: unknown,
  depth: number,
): unknown {
  if (
    entryValue !== null &&
    typeof entryValue === 'object' &&
    !Array.isArray(entryValue)
  ) {
    return validateMetadata(entryValue, depth + 1);
  }

  if (Array.isArray(entryValue)) {
    if (entryValue.length > AWS_ACCOUNT_METADATA_MAX_ARRAY_LENGTH) {
      throw new InvalidAwsAccountRecordError(
        'metadata array exceeds maximum length.',
      );
    }

    return entryValue.map((item) => {
      if (Array.isArray(item)) {
        return validateMetadataValue(item, depth + 1);
      }
      if (item !== null && typeof item === 'object') {
        return validateMetadata(item, depth + 1);
      }
      if (
        item === null ||
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean'
      ) {
        return item;
      }
      throw new InvalidAwsAccountRecordError(
        'metadata contains unsupported value types.',
      );
    });
  }

  if (
    entryValue === null ||
    typeof entryValue === 'string' ||
    typeof entryValue === 'number' ||
    typeof entryValue === 'boolean'
  ) {
    return entryValue;
  }

  throw new InvalidAwsAccountRecordError(
    'metadata contains unsupported value types.',
  );
}

function validateMetadata(value: unknown, depth = 0): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidAwsAccountRecordError(
      'metadata must be a JSON object.',
    );
  }

  if (depth > AWS_ACCOUNT_METADATA_MAX_DEPTH) {
    throw new InvalidAwsAccountRecordError(
      'metadata exceeds maximum nesting depth.',
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > AWS_ACCOUNT_METADATA_MAX_KEYS) {
    throw new InvalidAwsAccountRecordError(
      'metadata exceeds maximum key count.',
    );
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, entryValue] of entries) {
    if (entryValue === undefined) {
      continue;
    }
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new InvalidAwsAccountRecordError('metadata keys must be strings.');
    }
    normalized[key] = validateMetadataValue(entryValue, depth);
  }

  return normalized;
}

export function validateAwsAccountId(accountId: string): string {
  const trimmed = accountId.trim();
  if (!AWS_ACCOUNT_ID_PATTERN.test(trimmed)) {
    throw new InvalidAwsAccountRecordError(
      'accountId must be exactly 12 numeric digits.',
    );
  }
  return trimmed;
}

export function validateAwsAccountRoleArn(
  roleArn: string,
  accountId: string,
): string {
  const trimmed = roleArn.trim();
  const match = IAM_ROLE_ARN_PATTERN.exec(trimmed);
  if (!match) {
    throw new InvalidAwsAccountRecordError(
      'roleArn must be a valid IAM role ARN.',
    );
  }
  if (match[1] !== accountId) {
    throw new InvalidAwsAccountRecordError(
      'roleArn account must match accountId.',
    );
  }
  return trimmed;
}

export function validateAwsAccountRegion(region: string): string {
  const trimmed = region.trim();
  if (!AWS_REGION_PATTERN.test(trimmed)) {
    throw new InvalidAwsAccountRecordError(
      'region must be a valid AWS region identifier.',
    );
  }
  return trimmed;
}

export function validateAwsAccountExternalId(externalId: string): string {
  const trimmed = externalId.trim();
  if (trimmed.length === 0) {
    throw new InvalidAwsAccountRecordError('externalId is required.');
  }
  if (trimmed.length > AWS_ACCOUNT_EXTERNAL_ID_MAX_LENGTH) {
    throw new InvalidAwsAccountRecordError(
      'externalId exceeds maximum length.',
    );
  }
  return trimmed;
}

export function validateAwsAccountShape(
  input: Omit<
    AwsAccountRecord,
    'version' | 'createdAt' | 'updatedAt'
  > & {
    version?: number;
    createdAt?: string;
    updatedAt?: string;
  },
): AwsAccountRecord {
  const accountId = validateAwsAccountId(input.accountId);
  const tenantValidation = validateTenantId(input.tenantId);
  if (!tenantValidation.valid || !tenantValidation.normalized) {
    throw new InvalidAwsAccountRecordError(
      tenantValidation.reason ?? 'tenantId is invalid.',
    );
  }
  const tenantId = tenantValidation.normalized;
  const roleArn = validateAwsAccountRoleArn(input.roleArn, accountId);
  const externalId = validateAwsAccountExternalId(input.externalId);
  const region = validateAwsAccountRegion(input.region);

  const status = input.status;
  const verificationStatus = input.verificationStatus;
  if (!status || !verificationStatus) {
    throw new InvalidAwsAccountRecordError(
      'status and verificationStatus are required.',
    );
  }

  const version = input.version ?? 1;
  if (!Number.isInteger(version) || version < 1) {
    throw new InvalidAwsAccountRecordError(
      'version must be a positive integer.',
    );
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  const updatedAt = input.updatedAt ?? createdAt;
  assertIsoTimestamp(createdAt, 'createdAt');
  assertIsoTimestamp(updatedAt, 'updatedAt');

  if (input.lastValidated !== undefined) {
    assertIsoTimestamp(input.lastValidated, 'lastValidated');
  }

  const metadata = validateMetadata(input.metadata);

  if (
    status === 'PENDING' &&
    verificationStatus !== 'NOT_STARTED' &&
    verificationStatus !== 'FAILED'
  ) {
    throw new InvalidAwsAccountRecordError(
      'PENDING accounts must use NOT_STARTED or FAILED verification status.',
    );
  }

  if (status === 'VALIDATING' && verificationStatus !== 'IN_PROGRESS') {
    throw new InvalidAwsAccountRecordError(
      'VALIDATING accounts must use IN_PROGRESS verification status.',
    );
  }

  if (status === 'VERIFIED' && verificationStatus !== 'SUCCEEDED') {
    throw new InvalidAwsAccountRecordError(
      'VERIFIED accounts must use SUCCEEDED verification status.',
    );
  }

  if (status === 'DELETED' && verificationStatus === 'IN_PROGRESS') {
    throw new InvalidAwsAccountRecordError(
      'DELETED accounts cannot be IN_PROGRESS.',
    );
  }

  if (
    input.lastValidated !== undefined &&
    verificationStatus !== 'SUCCEEDED' &&
    verificationStatus !== 'FAILED' &&
    verificationStatus !== 'IN_PROGRESS'
  ) {
    throw new InvalidAwsAccountRecordError(
      'lastValidated is only valid after a completed validation attempt or while validation is in progress.',
    );
  }

  if (
    input.lastValidated !== undefined &&
    verificationStatus === 'NOT_STARTED'
  ) {
    throw new InvalidAwsAccountRecordError(
      'lastValidated requires verification progress beyond NOT_STARTED.',
    );
  }

  return {
    accountId,
    tenantId,
    roleArn,
    externalId,
    region,
    status,
    verificationStatus,
    lastValidated: input.lastValidated,
    metadata,
    version,
    createdAt,
    updatedAt,
  };
}
