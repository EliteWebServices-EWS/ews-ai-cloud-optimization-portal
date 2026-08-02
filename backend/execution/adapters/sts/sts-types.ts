import type { AuditActor } from '../../../audit';
import type { StructuredExecutionError } from '../types';

/**
 * Cross-account trust configuration for one tenant's AWS account.
 *
 * Tenant AWS-account registration is not yet modeled in the repository
 * layer, so this is accepted as explicit input from the caller until that
 * onboarding flow exists. ExternalId is mandatory — accepting AssumeRole
 * without it is the canonical "confused deputy" cross-account vulnerability
 * AWS's own STS documentation warns against.
 */
export interface AwsAccountRoleConfig {
  tenantId: string;
  roleArn: string;
  externalId: string;
  /** Prefixed onto a generated suffix to build the STS RoleSessionName. */
  sessionNamePrefix?: string;
  /** Requested credential lifetime. Default 3600s (AWS minimum is 900s). */
  durationSeconds?: number;
}

export interface AssumedCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
  assumedRoleId: string;
  sessionName: string;
}

/** Audit identity for AssumeRole calls triggered outside an HTTP request. */
export interface StsAssumeRoleContext {
  actorId: string;
  actor: AuditActor;
  requestId: string;
  correlationId: string;
  workflowId?: string;
}

export interface PermissionCheckResult {
  service: string;
  action: string;
  granted: boolean;
  error?: StructuredExecutionError;
}

export interface PermissionValidationReport {
  allGranted: boolean;
  results: PermissionCheckResult[];
}

export type CapabilityVerificationStatus = 'VERIFIED' | 'FAILED' | 'UNAVAILABLE';

export type LeastPrivilegeAssurance =
  | 'VERIFIED'
  | 'NOT_VERIFIED'
  | 'POLICY_REVIEW_REQUIRED';

export interface AwsAccountCapabilityCheck {
  capability: string;
  action: string;
  status: CapabilityVerificationStatus;
  errorCode?: string;
}

export interface AwsAccountPermissionSummary {
  requiredReadCapabilities: AwsAccountCapabilityCheck[];
  optionalDiscoveryCapabilities: AwsAccountCapabilityCheck[];
  leastPrivilegeAssurance: LeastPrivilegeAssurance;
  leastPrivilegeReason: string;
  /** Legacy execution read checks retained for verify() compatibility. */
  executionReadReport: PermissionValidationReport;
}

export type AwsAccountDiscoveryWarningCode =
  | 'ACCOUNT_ALIAS_UNAVAILABLE'
  | 'ORGANIZATION_UNAVAILABLE'
  | 'ORGANIZATION_ACCESS_DENIED'
  | 'OPTIONAL_CAPABILITY_UNAVAILABLE';

export interface AwsAccountDiscoveryWarning {
  code: AwsAccountDiscoveryWarningCode;
  message: string;
}

export interface AwsAccountDiscoveryResult {
  accountId: string;
  principalArn: string;
  accountAlias?: string;
  organizationId?: string;
  enabledRegions: string[];
  discoveredAt: string;
  permissionSummary: AwsAccountPermissionSummary;
  warnings: AwsAccountDiscoveryWarning[];
}

/** Sanitized discovery payload stored under metadata.discovery. */
export interface AwsAccountDiscoveryMetadata {
  accountId: string;
  principalArn: string;
  accountAlias?: string;
  organizationId?: string;
  enabledRegions: string[];
  discoveredAt: string;
  permissionSummary: AwsAccountPermissionSummary;
  warnings: AwsAccountDiscoveryWarning[];
}

export class StsProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StsProviderError';
  }

  toStructuredError(stage: string): StructuredExecutionError {
    return {
      code: this.code,
      message: this.message,
      stage,
      retryable: this.retryable,
    };
  }
}

export function validateRoleConfig(config: AwsAccountRoleConfig): void {
  if (!config.tenantId?.trim()) {
    throw new StsProviderError(
      'TENANT_REQUIRED',
      'tenantId is required to assume an AWS role.',
      false,
    );
  }

  if (!/^arn:aws:iam::\d{12}:role\/[\w+=,.@-]+$/.test(config.roleArn ?? '')) {
    throw new StsProviderError(
      'INVALID_ROLE_ARN',
      'roleArn must be a valid IAM role ARN (arn:aws:iam::<account>:role/<name>).',
      false,
    );
  }

  if (!config.externalId?.trim()) {
    throw new StsProviderError(
      'EXTERNAL_ID_REQUIRED',
      'externalId is required. AssumeRole without ExternalId is not permitted ' +
        '(confused-deputy protection).',
      false,
    );
  }

  const duration = config.durationSeconds ?? 3600;
  if (duration < 900 || duration > 43200) {
    throw new StsProviderError(
      'INVALID_DURATION',
      'durationSeconds must be between 900 and 43200.',
      false,
    );
  }
}
