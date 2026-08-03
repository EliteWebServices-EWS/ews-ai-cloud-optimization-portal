/**
 * Sprint 13 production evidence JSON parsing and validation (no I/O, no AWS).
 */

export const REGISTRATION_LIFECYCLE_STATUSES = [
  'PENDING',
  'VALIDATING',
  'VERIFIED',
  'SUSPENDED',
] as const;

export class Sprint13EvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Sprint13EvidenceValidationError';
  }
}

export function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

export function redactSensitive(value: unknown): string {
  if (value === undefined || value === null) return '[missing]';
  const s = String(value);
  if (s.length <= 4) return '****';
  return `${s.slice(0, 2)}…${s.slice(-2)} (len=${s.length})`;
}

/** Reads `data` when the payload is a SISU'M API envelope. */
export function getDataEnvelope(value: unknown): Record<string, unknown> | undefined {
  const root = asRecord(value);
  if (!root) {
    return undefined;
  }
  if (!('success' in root)) {
    return undefined;
  }
  if (root.success === false) {
    throw new Sprint13EvidenceValidationError('API response success is false');
  }
  const data = asRecord(root.data);
  if (!data) {
    throw new Sprint13EvidenceValidationError('Missing or malformed data envelope');
  }
  return data;
}

function readAccountId(record: Record<string, unknown>): string | undefined {
  const id = record.accountId ?? record.account_id;
  return id === undefined || id === null ? undefined : String(id);
}

/** Registration: envelope `data`, optional `data.account`, or direct record. */
export function getRegistrationRecord(value: unknown): Record<string, unknown> {
  const envelopeData = getDataEnvelope(value);
  if (envelopeData) {
    const nestedAccount = asRecord(envelopeData.account);
    if (nestedAccount && readAccountId(nestedAccount)) {
      return nestedAccount;
    }
    if (readAccountId(envelopeData)) {
      return envelopeData;
    }
    throw new Sprint13EvidenceValidationError(
      'Registration data envelope missing accountId',
    );
  }

  const direct = asRecord(value);
  if (direct && readAccountId(direct)) {
    return direct;
  }

  throw new Sprint13EvidenceValidationError('Unable to resolve registration record');
}

export interface VerificationEvidenceData {
  account: Record<string, unknown>;
  succeeded?: boolean;
  permissionReport?: Record<string, unknown>;
}

/** Verification: envelope `data` or direct account record. */
export function getVerificationData(value: unknown): VerificationEvidenceData {
  const envelopeData = getDataEnvelope(value);
  if (envelopeData) {
    const account = asRecord(envelopeData.account);
    if (!account || !readAccountId(account)) {
      throw new Sprint13EvidenceValidationError(
        'Verification data envelope missing account',
      );
    }
    return {
      account,
      succeeded:
        typeof envelopeData.succeeded === 'boolean'
          ? envelopeData.succeeded
          : undefined,
      permissionReport: asRecord(envelopeData.permissionReport),
    };
  }

  const direct = asRecord(value);
  if (direct && readAccountId(direct)) {
    return { account: direct };
  }

  throw new Sprint13EvidenceValidationError('Unable to resolve verification data');
}

export interface DiscoveryEvidenceData {
  account: Record<string, unknown>;
  discovery: Record<string, unknown>;
}

/** Discovery: envelope, account + metadata.discovery, or direct discovery object. */
export function getDiscoveryData(value: unknown): DiscoveryEvidenceData {
  const envelopeData = getDataEnvelope(value);
  if (envelopeData) {
    const account = asRecord(envelopeData.account);
    const discovery = asRecord(envelopeData.discovery);
    if (!account || !readAccountId(account)) {
      throw new Sprint13EvidenceValidationError(
        'Discovery data envelope missing account',
      );
    }
    if (!discovery || !readAccountId(discovery)) {
      throw new Sprint13EvidenceValidationError(
        'Discovery data envelope missing discovery',
      );
    }
    return { account, discovery };
  }

  const root = asRecord(value);
  if (!root) {
    throw new Sprint13EvidenceValidationError('Discovery evidence must be an object');
  }

  const nestedAccount = asRecord(root.account);
  const meta = asRecord(root.metadata);
  const metaDiscovery = asRecord(meta?.discovery);
  if (nestedAccount && readAccountId(nestedAccount) && metaDiscovery) {
    return { account: nestedAccount, discovery: metaDiscovery };
  }

  if (readAccountId(root) && metaDiscovery) {
    return { account: root, discovery: metaDiscovery };
  }

  const permissionSummary = asRecord(root.permissionSummary);
  if (permissionSummary && readAccountId(root)) {
    const accountId = readAccountId(root)!;
    const account: Record<string, unknown> = {
      accountId,
      tenantId: root.tenantId,
      status: root.status ?? 'VERIFIED',
      version: root.version,
    };
    return { account, discovery: root };
  }

  throw new Sprint13EvidenceValidationError('Unable to resolve discovery evidence');
}

export interface EvidenceExpectations {
  expectedAccountId: string;
  expectedTenantId?: string;
}

export function validateRegistrationEvidence(
  value: unknown,
  expectations: EvidenceExpectations,
): Record<string, unknown> {
  const record = getRegistrationRecord(value);
  const accountId = readAccountId(record);
  if (accountId !== expectations.expectedAccountId) {
    throw new Sprint13EvidenceValidationError(
      'Registration accountId does not match expected customer account',
    );
  }

  if (expectations.expectedTenantId) {
    const tenantId = record.tenantId ?? record.tenant_id;
    if (String(tenantId) !== expectations.expectedTenantId) {
      throw new Sprint13EvidenceValidationError(
        'Registration tenantId does not match expected tenant',
      );
    }
  }

  const status = record.status;
  if (typeof status === 'string') {
    if (
      !REGISTRATION_LIFECYCLE_STATUSES.includes(
        status as (typeof REGISTRATION_LIFECYCLE_STATUSES)[number],
      )
    ) {
      throw new Sprint13EvidenceValidationError(
        `Registration status is not a valid lifecycle state: ${status}`,
      );
    }
  }

  return record;
}

function assertPositiveIntegerVersion(version: unknown, label: string): void {
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Sprint13EvidenceValidationError(
      `${label} version must be a positive integer`,
    );
  }
}

function validatePermissionReport(permissionReport: Record<string, unknown> | undefined): void {
  if (!permissionReport) {
    throw new Sprint13EvidenceValidationError('Verification missing permissionReport');
  }
  if (permissionReport.allGranted !== true) {
    throw new Sprint13EvidenceValidationError(
      'Verification permissionReport.allGranted is not true',
    );
  }
  const results = permissionReport.results;
  if (!Array.isArray(results)) {
    throw new Sprint13EvidenceValidationError(
      'Verification permissionReport.results must be an array',
    );
  }
  for (const entry of results) {
    const row = asRecord(entry);
    if (!row || row.granted !== true) {
      throw new Sprint13EvidenceValidationError(
        'Verification permission result is not granted',
      );
    }
  }
}

export function validateVerificationEvidence(
  value: unknown,
  expectations: EvidenceExpectations,
): VerificationEvidenceData {
  const parsed = getVerificationData(value);
  const { account } = parsed;

  if (parsed.succeeded === false) {
    throw new Sprint13EvidenceValidationError('Verification data.succeeded is false');
  }
  if (parsed.succeeded !== undefined && parsed.succeeded !== true) {
    throw new Sprint13EvidenceValidationError('Verification data.succeeded is not true');
  }

  const accountId = readAccountId(account);
  if (accountId !== expectations.expectedAccountId) {
    throw new Sprint13EvidenceValidationError(
      'Verification accountId does not match expected customer account',
    );
  }

  if (expectations.expectedTenantId) {
    const tenantId = account.tenantId ?? account.tenant_id;
    if (String(tenantId) !== expectations.expectedTenantId) {
      throw new Sprint13EvidenceValidationError(
        'Verification tenantId does not match expected tenant',
      );
    }
  }

  if (account.status !== 'VERIFIED') {
    throw new Sprint13EvidenceValidationError('Verification account.status is not VERIFIED');
  }
  if (account.verificationStatus !== 'SUCCEEDED') {
    throw new Sprint13EvidenceValidationError(
      'Verification account.verificationStatus is not SUCCEEDED',
    );
  }

  assertPositiveIntegerVersion(account.version, 'Verification account');

  const envelopeData = getDataEnvelope(value);
  if (envelopeData) {
    validatePermissionReport(asRecord(envelopeData.permissionReport));
  } else if (parsed.permissionReport) {
    validatePermissionReport(parsed.permissionReport);
  }

  return parsed;
}

function assertDiscoveryConsistency(
  account: Record<string, unknown>,
  discovery: Record<string, unknown>,
): void {
  const accountId = readAccountId(account);
  const discoveryAccountId = readAccountId(discovery);
  if (accountId && discoveryAccountId && accountId !== discoveryAccountId) {
    throw new Sprint13EvidenceValidationError(
      'Discovery account and discovery.accountId are inconsistent',
    );
  }

  const meta = asRecord(account.metadata);
  const metaDiscovery = asRecord(meta?.discovery);
  if (metaDiscovery) {
    const metaAccountId = readAccountId(metaDiscovery);
    if (metaAccountId && accountId && metaAccountId !== accountId) {
      throw new Sprint13EvidenceValidationError(
        'Account metadata.discovery accountId inconsistent with account',
      );
    }
  }
}

export function validateDiscoveryEvidence(
  value: unknown,
  expectations: EvidenceExpectations,
): DiscoveryEvidenceData {
  const parsed = getDiscoveryData(value);
  const { account, discovery } = parsed;

  const accountId = readAccountId(account);
  const discoveryAccountId = readAccountId(discovery);
  if (discoveryAccountId !== expectations.expectedAccountId) {
    throw new Sprint13EvidenceValidationError(
      'Discovery discovery.accountId does not match expected customer account',
    );
  }
  if (accountId !== expectations.expectedAccountId) {
    throw new Sprint13EvidenceValidationError(
      'Discovery account.accountId does not match expected customer account',
    );
  }

  if (expectations.expectedTenantId) {
    const tenantId = account.tenantId ?? account.tenant_id;
    if (String(tenantId) !== expectations.expectedTenantId) {
      throw new Sprint13EvidenceValidationError(
        'Discovery tenantId does not match expected tenant',
      );
    }
  }

  if (account.status !== 'VERIFIED') {
    throw new Sprint13EvidenceValidationError('Discovery account.status is not VERIFIED');
  }

  assertPositiveIntegerVersion(account.version, 'Discovery account');

  const principalArn = discovery.principalArn;
  if (typeof principalArn !== 'string' || principalArn.length === 0) {
    throw new Sprint13EvidenceValidationError('Discovery missing principalArn');
  }
  const expectedPrincipalPrefix = `arn:aws:sts::${expectations.expectedAccountId}:assumed-role/`;
  if (!principalArn.startsWith(expectedPrincipalPrefix)) {
    throw new Sprint13EvidenceValidationError(
      'Discovery principalArn does not match expected assumed-role pattern',
    );
  }

  const permissionSummary = asRecord(discovery.permissionSummary);
  if (!permissionSummary) {
    throw new Sprint13EvidenceValidationError('Discovery missing permissionSummary');
  }

  const lpa = permissionSummary.leastPrivilegeAssurance;
  if (lpa === undefined || lpa === null || lpa === '') {
    throw new Sprint13EvidenceValidationError(
      'Discovery permissionSummary.leastPrivilegeAssurance is missing',
    );
  }
  if (lpa === 'VERIFIED') {
    throw new Sprint13EvidenceValidationError(
      'Discovery leastPrivilegeAssurance must not be VERIFIED',
    );
  }
  if (lpa !== 'NOT_VERIFIED') {
    throw new Sprint13EvidenceValidationError(
      'Discovery leastPrivilegeAssurance must be NOT_VERIFIED',
    );
  }

  const requiredReadCapabilities = permissionSummary.requiredReadCapabilities;
  if (!Array.isArray(requiredReadCapabilities) || requiredReadCapabilities.length === 0) {
    throw new Sprint13EvidenceValidationError(
      'Discovery missing requiredReadCapabilities',
    );
  }
  for (const cap of requiredReadCapabilities) {
    const row = asRecord(cap);
    if (!row || row.status !== 'VERIFIED') {
      throw new Sprint13EvidenceValidationError(
        'Discovery requiredReadCapabilities contains non-VERIFIED entry',
      );
    }
  }

  const executionReadReport = asRecord(permissionSummary.executionReadReport);
  if (!executionReadReport || executionReadReport.allGranted !== true) {
    throw new Sprint13EvidenceValidationError(
      'Discovery executionReadReport.allGranted is not true',
    );
  }

  assertDiscoveryConsistency(account, discovery);

  return parsed;
}

/** Safe log line when externalId is present (never full value). */
export function formatExternalIdPresence(record: Record<string, unknown>): string {
  if (!('externalId' in record) || record.externalId === undefined) {
    return '';
  }
  return `externalId present (${redactSensitive(record.externalId)})`;
}
