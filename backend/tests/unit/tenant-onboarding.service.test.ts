import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MockTenantRepository } from '../../repositories/mock/mock-tenant-repository';
import {
  InMemoryCognitoIdentityAlignment,
} from '../../cognito/cognito-identity-alignment';
import {
  createTenantOnboardingService,
} from '../../services/tenant-onboarding.service';
import { AppError, isAppError } from '../../shared/utils';

function createBody(ownerUserId: string, slug: string) {
  return {
    organizationName: 'Org',
    displayName: 'Display',
    slug,
    ownerUserId,
    primaryContact: { name: 'Contact', email: 'c@example.com' },
    region: 'us-east-1',
    subscriptionPlan: 'standard',
  };
}

describe('TenantOnboardingService', () => {
  it('transitions PROVISIONING to ACTIVE after Cognito assignment', async () => {
    const tenantRepository = new MockTenantRepository();
    const cognitoAlignment = new InMemoryCognitoIdentityAlignment();
    const service = createTenantOnboardingService({
      tenantRepository,
      cognitoAlignment,
    });

    const result = await service.onboardNewTenant(
      createBody('owner-sub', 'onboard-slug-a'),
    );

    assert.equal(result.tenant.status, 'ACTIVE');
    assert.equal(result.reauthenticationRequired, true);
    assert.equal(cognitoAlignment.assignments.get('owner-sub'), result.tenant.tenantId);
  });

  it('leaves tenant PROVISIONING when Cognito assignment fails', async () => {
    const tenantRepository = new MockTenantRepository();
    const cognitoAlignment = new InMemoryCognitoIdentityAlignment();
    cognitoAlignment.failWith = new AppError(
      'COGNITO_ALIGNMENT_FAILED',
      'simulated failure',
      503,
      'tenant-onboarding',
    );
    const service = createTenantOnboardingService({
      tenantRepository,
      cognitoAlignment,
    });

    await assert.rejects(
      () => service.onboardNewTenant(createBody('owner-sub', 'fail-slug')),
      (error: unknown) =>
        isAppError(error) && error.code === 'COGNITO_ALIGNMENT_FAILED',
    );

    const tenants = await tenantRepository.listAll();
    assert.equal(tenants.items.length, 1);
    assert.equal(tenants.items[0]!.status, 'PROVISIONING');
  });

  it('completeOnboarding retry is idempotent for ACTIVE tenant', async () => {
    const tenantRepository = new MockTenantRepository();
    const cognitoAlignment = new InMemoryCognitoIdentityAlignment();
    const service = createTenantOnboardingService({
      tenantRepository,
      cognitoAlignment,
    });

    const created = await service.onboardNewTenant(
      createBody('owner-sub', 'retry-slug'),
    );

    const retry = await service.completeOnboarding(created.tenant.tenantId);

    assert.equal(retry.tenant.status, 'ACTIVE');
    assert.equal(retry.reauthenticationRequired, false);
    assert.equal(cognitoAlignment.assignments.size, 1);
  });
});
