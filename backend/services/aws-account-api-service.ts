/**
 * AWS Account API service — the business logic behind the AWS Account
 * Management APIs (Sprint 13, Engineer 3).
 *
 * Wired to the real dependencies that landed after this branch was first
 * built:
 *  - AwsAccountRepository (Engineer 1, PR #185): persistence, optimistic
 *    locking, lifecycle/status-consistency validation, global accountId
 *    uniqueness.
 *  - StsCredentialProvider / validateRequiredPermissions (Engineer 2,
 *    PR #183): real AWS STS AssumeRole + a per-service read-only
 *    permission check, used by verify().
 *
 * This layer owns externalId generation and output sanitization so route
 * handlers stay thin.
 */

import type { AuditActor } from '../audit';
import { RepositoryNotFoundError } from '../database';
import type {
  AwsAccountRepository,
  UpdateAwsAccountPatch,
} from '../repositories/contracts/aws-account-repository';
import type { AwsAccountRecord } from '../repositories/models/aws-account-persistence-models';
import {
  validateAwsAccountTransition,
  verificationFieldsForValidationFailure,
  verificationFieldsForValidationStart,
  verificationFieldsForValidationSuccess,
} from './aws-account-lifecycle';
import {
  applyAwsAccountQuery,
  fetchAllTenantAwsAccounts,
  type AwsAccountQuery,
  type AwsAccountQueryResult,
} from './aws-account-query';
import {
  createAssumeRoleClientFactory,
  StsCredentialProvider,
  validateRequiredPermissions,
  type AwsAccountRoleConfig,
  type PermissionValidationReport,
  type StsAssumeRoleContext,
} from '../execution/adapters/sts';
import { generateExternalId } from '../shared/utils';

/**
 * Seam between this service and Engineer 2's real per-service IAM
 * permission check. Production code uses DefaultAwsAccountPermissionChecker
 * (real AWS SDK calls via createAssumeRoleClientFactory); tests inject a
 * stub so verify() can be exercised without reaching real AWS APIs.
 */
export interface AwsAccountPermissionChecker {
  check(
    roleConfig: AwsAccountRoleConfig,
    region: string,
    credentialProvider: StsCredentialProvider,
    stsContext: StsAssumeRoleContext,
  ): Promise<PermissionValidationReport>;
}

export class DefaultAwsAccountPermissionChecker implements AwsAccountPermissionChecker {
  async check(
    roleConfig: AwsAccountRoleConfig,
    region: string,
    credentialProvider: StsCredentialProvider,
    stsContext: StsAssumeRoleContext,
  ): Promise<PermissionValidationReport> {
    const clientFactory = createAssumeRoleClientFactory(roleConfig, {
      credentialProvider,
      auditContext: stsContext,
    });
    return validateRequiredPermissions(clientFactory(region));
  }
}

export interface RegisterAwsAccountInput {
  accountId: string;
  roleArn: string;
  region: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateAwsAccountConfigurationInput {
  region?: string;
  metadata?: Record<string, unknown>;
}

/** Identity/tracing context needed to attribute an outbound AssumeRole call. */
export interface AwsAccountCallContext {
  actor: AuditActor;
  requestId: string;
  correlationId: string;
}

export interface VerifyAwsAccountResult {
  account: AwsAccountRecord;
  succeeded: boolean;
  permissionReport?: PermissionValidationReport;
  failureReason?: string;
}

/** Public-facing AWS account shape — externalId is masked outside registration. */
export interface SanitizedAwsAccountRecord
  extends Omit<AwsAccountRecord, 'externalId'> {
  externalId: string;
}

function maskExternalId(externalId: string): string {
  if (externalId.length <= 4) {
    return '••••';
  }
  return `••••${externalId.slice(-4)}`;
}

export function sanitizeAwsAccountRecord(
  record: AwsAccountRecord,
): SanitizedAwsAccountRecord {
  return {
    ...record,
    externalId: maskExternalId(record.externalId),
  };
}

export interface AwsAccountConnectionStatus {
  accountId: string;
  status: AwsAccountRecord['status'];
  verificationStatus: AwsAccountRecord['verificationStatus'];
  lastValidated?: string;
}

export class AwsAccountApiService {
  public constructor(
    private readonly repository: AwsAccountRepository,
    private readonly credentialProvider: StsCredentialProvider = new StsCredentialProvider(),
    private readonly permissionChecker: AwsAccountPermissionChecker = new DefaultAwsAccountPermissionChecker(),
  ) {}

  /**
   * Registers a new AWS account connection for a tenant. Returns the
   * *unmasked* externalId exactly once — the tenant needs the full value
   * to configure their IAM role trust policy. Every subsequent read
   * returns it masked.
   *
   * accountId uniqueness is global across the whole platform (Option A —
   * see AwsAccountRepository), enforced by the repository, not here.
   */
  public async register(
    tenantId: string,
    input: RegisterAwsAccountInput,
  ): Promise<AwsAccountRecord> {
    return this.repository.create({
      tenantId,
      accountId: input.accountId,
      roleArn: input.roleArn,
      externalId: generateExternalId(),
      region: input.region,
      status: 'PENDING',
      verificationStatus: 'NOT_STARTED',
      metadata: input.metadata ?? {},
    });
  }

  public async getById(
    tenantId: string,
    accountId: string,
  ): Promise<AwsAccountRecord | undefined> {
    return this.repository.getById(tenantId, accountId);
  }

  /**
   * Validates the AssumeRole trust relationship (Engineer 2's
   * StsCredentialProvider — a real STS AssumeRole call) and the minimum
   * required IAM permissions (Engineer 2's validateRequiredPermissions),
   * moving the connection through VALIDATING to either VERIFIED or back
   * to a safe prior status.
   *
   * A validation failure is a normal, expected outcome (bad trust policy,
   * missing permissions, revoked role) — this resolves rather than
   * throws for that case; it only throws for programmer/infra errors
   * (not found, stale version).
   */
  public async verify(
    tenantId: string,
    accountId: string,
    expectedVersion: number,
    context: AwsAccountCallContext,
  ): Promise<VerifyAwsAccountResult> {
    const existing = await this.repository.getById(tenantId, accountId);
    if (!existing) {
      throw new RepositoryNotFoundError(
        `AWS account connection ${accountId} was not found.`,
      );
    }

    const previousStatus = existing.status;
    validateAwsAccountTransition(previousStatus, 'VALIDATING');

    const validating = await this.repository.transitionStatus(
      tenantId,
      accountId,
      'VALIDATING',
      { expectedVersion },
      verificationFieldsForValidationStart(),
    );

    const roleConfig: AwsAccountRoleConfig = {
      tenantId,
      roleArn: validating.roleArn,
      externalId: validating.externalId,
      sessionNamePrefix: 'sisum-verify',
    };
    const stsContext: StsAssumeRoleContext = {
      actorId: context.actor.userId ?? 'unknown',
      actor: context.actor,
      requestId: context.requestId,
      correlationId: context.correlationId,
    };

    try {
      await this.credentialProvider.getCredentials(roleConfig, stsContext);

      const permissionReport = await this.permissionChecker.check(
        roleConfig,
        validating.region,
        this.credentialProvider,
        stsContext,
      );

      if (!permissionReport.allGranted) {
        const missing = permissionReport.results
          .filter((result) => !result.granted)
          .map((result) => result.action)
          .join(', ');

        return this.failVerification(
          tenantId,
          accountId,
          validating.version,
          previousStatus,
          `Missing required IAM permissions: ${missing}`,
          permissionReport,
        );
      }

      const verified = await this.repository.transitionStatus(
        tenantId,
        accountId,
        'VERIFIED',
        { expectedVersion: validating.version },
        verificationFieldsForValidationSuccess(new Date().toISOString()),
      );

      return { account: verified, succeeded: true, permissionReport };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'AssumeRole validation failed.';
      return this.failVerification(
        tenantId,
        accountId,
        validating.version,
        previousStatus,
        reason,
      );
    }
  }

  /**
   * Reverts a VALIDATING connection to a safe status after a failed
   * verification attempt. Re-verifying an already-VERIFIED connection
   * that now fails moves it to SUSPENDED rather than leaving it VERIFIED
   * with a FAILED verificationStatus, which the model's own consistency
   * rules (VERIFIED requires SUCCEEDED) would reject outright — and,
   * more importantly, silently keeping a connection that just failed
   * trust/permission checks marked VERIFIED would be actively misleading.
   */
  private async failVerification(
    tenantId: string,
    accountId: string,
    validatingVersion: number,
    previousStatus: AwsAccountRecord['status'],
    reason: string,
    permissionReport?: PermissionValidationReport,
  ): Promise<VerifyAwsAccountResult> {
    const revertTo = previousStatus === 'PENDING' ? 'PENDING' : 'SUSPENDED';

    const reverted = await this.repository.transitionStatus(
      tenantId,
      accountId,
      revertTo,
      { expectedVersion: validatingVersion },
      verificationFieldsForValidationFailure(new Date().toISOString()),
    );

    return {
      account: reverted,
      succeeded: false,
      permissionReport,
      failureReason: reason,
    };
  }

  public async updateConfiguration(
    tenantId: string,
    accountId: string,
    changes: UpdateAwsAccountConfigurationInput,
    expectedVersion: number,
  ): Promise<AwsAccountRecord> {
    const patch: UpdateAwsAccountPatch = {};
    if (changes.region !== undefined) {
      patch.region = changes.region;
    }
    if (changes.metadata !== undefined) {
      patch.metadata = changes.metadata;
    }

    return this.repository.update(tenantId, accountId, patch, {
      expectedVersion,
    });
  }

  /** Soft-deletes the connection (status -> DELETED). */
  public async remove(
    tenantId: string,
    accountId: string,
    expectedVersion: number,
  ): Promise<AwsAccountRecord> {
    return this.repository.transitionStatus(tenantId, accountId, 'DELETED', {
      expectedVersion,
    });
  }

  public async list(
    tenantId: string,
    query: AwsAccountQuery,
  ): Promise<AwsAccountQueryResult> {
    const allAccounts = await fetchAllTenantAwsAccounts((page) =>
      this.repository.listByTenant(tenantId, page),
    );

    return applyAwsAccountQuery(allAccounts, query);
  }

  public async getConnectionStatus(
    tenantId: string,
    accountId: string,
  ): Promise<AwsAccountConnectionStatus | undefined> {
    const record = await this.repository.getById(tenantId, accountId);
    if (!record) {
      return undefined;
    }

    return {
      accountId: record.accountId,
      status: record.status,
      verificationStatus: record.verificationStatus,
      lastValidated: record.lastValidated,
    };
  }
}
