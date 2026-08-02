import type {
  AwsAccountDiscoveryMetadata,
  AwsAccountDiscoveryResult,
} from '../execution/adapters/sts/sts-types';

import { AppError } from '../shared/utils';

export class AwsAccountIdentityMismatchError extends AppError {
  public readonly registeredAccountId: string;
  public readonly discoveredAccountId: string;

  constructor(registeredAccountId: string, discoveredAccountId: string) {
    super(
      'AWS_ACCOUNT_IDENTITY_MISMATCH',
      'Discovered AWS account ID does not match the registered connection.',
      409,
      'aws-account-discovery',
    );
    this.registeredAccountId = registeredAccountId;
    this.discoveredAccountId = discoveredAccountId;
  }
}

export class AwsAccountDiscoveryError extends AppError {
  constructor(code: string, message: string, statusCode = 502) {
    super(code, message, statusCode, 'aws-account-discovery');
  }
}

const FORBIDDEN_MATERIAL_KEYS = new Set([
  'accesskeyid',
  'secretaccesskey',
  'sessiontoken',
  'authorization',
  'password',
  'token',
]);

export function assertNoCredentialMaterial(value: unknown, path = 'value'): void {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertNoCredentialMaterial(value[index], `${path}[${index}]`);
    }
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_MATERIAL_KEYS.has(key.toLowerCase())) {
      throw new Error(`Credential material must not appear at ${path}.${key}`);
    }
    assertNoCredentialMaterial(entryValue, `${path}.${key}`);
  }
}

export function toDiscoveryMetadata(
  result: AwsAccountDiscoveryResult,
): AwsAccountDiscoveryMetadata {
  const metadata: AwsAccountDiscoveryMetadata = {
    accountId: result.accountId,
    principalArn: result.principalArn,
    accountAlias: result.accountAlias,
    organizationId: result.organizationId,
    enabledRegions: [...result.enabledRegions],
    discoveredAt: result.discoveredAt,
    permissionSummary: {
      requiredReadCapabilities: result.permissionSummary.requiredReadCapabilities.map(
        (entry) => ({
          capability: entry.capability,
          action: entry.action,
          status: entry.status,
          ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
        }),
      ),
      optionalDiscoveryCapabilities:
        result.permissionSummary.optionalDiscoveryCapabilities.map((entry) => ({
          capability: entry.capability,
          action: entry.action,
          status: entry.status,
          ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
        })),
      leastPrivilegeAssurance: result.permissionSummary.leastPrivilegeAssurance,
      leastPrivilegeReason: result.permissionSummary.leastPrivilegeReason,
      executionReadReport: {
        allGranted: result.permissionSummary.executionReadReport.allGranted,
        results: result.permissionSummary.executionReadReport.results.map(
          (entry) => ({
            service: entry.service,
            action: entry.action,
            granted: entry.granted,
            ...(entry.error?.code ? { errorCode: entry.error.code } : {}),
          }),
        ),
      },
    },
    warnings: result.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
    })),
  };
  assertNoCredentialMaterial(metadata);
  return metadata;
}

export function mergeDiscoveryIntoMetadata(
  metadata: Record<string, unknown>,
  discovery: AwsAccountDiscoveryMetadata,
): Record<string, unknown> {
  assertNoCredentialMaterial(discovery);
  return {
    ...metadata,
    discovery,
  };
}

export function sanitizeDiscoveryResponse(
  result: AwsAccountDiscoveryResult,
): AwsAccountDiscoveryResult {
  assertNoCredentialMaterial(result);
  return structuredClone(result);
}
