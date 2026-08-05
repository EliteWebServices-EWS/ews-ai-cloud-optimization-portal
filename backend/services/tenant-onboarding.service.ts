/**
 * Tenant owner onboarding: registry tenantId ↔ Cognito custom:tenantId alignment.
 */

import type { CreateTenantInput, TenantRepository } from '../repositories/contracts';
import type { TenantRecord } from '../repositories/models';
import { AppError, generateTenantId, isAppError } from '../shared/utils';
import type { CognitoIdentityAlignmentPort } from '../cognito/cognito-identity-alignment';
import { CognitoIdentityAlignmentError } from '../cognito/cognito-identity-alignment';

export const ONBOARDING_METADATA_ALIGNED_AT = 'onboardingCognitoAlignedAt';

export interface TenantOnboardingServiceDeps {
  tenantRepository: TenantRepository;
  cognitoAlignment: CognitoIdentityAlignmentPort;
}

export interface TenantOnboardingResult {
  tenant: TenantRecord;
  reauthenticationRequired: boolean;
}

function mergeOnboardingMetadata(
  existing: Record<string, unknown> | undefined,
  alignedAt: string,
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    [ONBOARDING_METADATA_ALIGNED_AT]: alignedAt,
  };
}

function assertOnboardingRetryAllowed(tenant: TenantRecord): void {
  if (tenant.status === 'DELETED') {
    throw new AppError('NOT_FOUND', 'Tenant not found.', 404, 'tenant-onboarding');
  }

  if (tenant.status === 'SUSPENDED' || tenant.status === 'ARCHIVED') {
    throw new AppError(
      'TENANT_NOT_BOOTSTRAPPABLE',
      'Tenant onboarding cannot complete while the tenant is not eligible.',
      409,
      'tenant-onboarding',
    );
  }
}

export class TenantOnboardingService {
  private readonly tenantRepository: TenantRepository;
  private readonly cognitoAlignment: CognitoIdentityAlignmentPort;

  constructor(deps: TenantOnboardingServiceDeps) {
    this.tenantRepository = deps.tenantRepository;
    this.cognitoAlignment = deps.cognitoAlignment;
  }

  /**
   * Create tenant (PROVISIONING), assign Cognito custom:tenantId to ownerUserId (Cognito sub), then ACTIVE.
   */
  async onboardNewTenant(
    input: Omit<CreateTenantInput, 'tenantId' | 'status'>,
  ): Promise<TenantOnboardingResult> {
    const tenantId = generateTenantId();

    const tenant = await this.tenantRepository.create({
      ...input,
      tenantId,
      status: 'PROVISIONING',
    });

    return this.alignOwnerAndActivate(tenant);
  }

  /**
   * Retry Cognito alignment for a PROVISIONING tenant, or idempotent no-op when already ACTIVE.
   */
  async completeOnboarding(tenantId: string): Promise<TenantOnboardingResult> {
    const tenant = await this.tenantRepository.getById(tenantId);

    if (!tenant) {
      throw new AppError('NOT_FOUND', 'Tenant not found.', 404, 'tenant-onboarding');
    }

    assertOnboardingRetryAllowed(tenant);

    if (tenant.status === 'ACTIVE') {
      return {
        tenant,
        reauthenticationRequired: false,
      };
    }

    return this.alignOwnerAndActivate(tenant);
  }

  private async alignOwnerAndActivate(
    tenant: TenantRecord,
  ): Promise<TenantOnboardingResult> {
    try {
      await this.cognitoAlignment.assignTenantToUser({
        username: tenant.ownerUserId,
        tenantId: tenant.tenantId,
      });
    } catch (error) {
      if (isAppError(error)) {
        throw error;
      }

      if (error instanceof CognitoIdentityAlignmentError) {
        throw new AppError(
          'COGNITO_ALIGNMENT_FAILED',
          error.message,
          503,
          'tenant-onboarding',
        );
      }

      throw new AppError(
        'COGNITO_ALIGNMENT_FAILED',
        'Cognito tenant identity assignment failed. The tenant remains in PROVISIONING; retry complete-onboarding.',
        503,
        'tenant-onboarding',
      );
    }

    const alignedAt = new Date().toISOString();

    const active = await this.tenantRepository.transitionStatus(
      tenant.tenantId,
      'ACTIVE',
      { expectedVersion: tenant.version },
    );

    const withMetadata = await this.tenantRepository.update(
      tenant.tenantId,
      {
        metadata: mergeOnboardingMetadata(active.metadata, alignedAt),
      },
      { expectedVersion: active.version },
    );

    return {
      tenant: withMetadata,
      reauthenticationRequired: true,
    };
  }
}

export function createTenantOnboardingService(
  deps: TenantOnboardingServiceDeps,
): TenantOnboardingService {
  return new TenantOnboardingService(deps);
}
