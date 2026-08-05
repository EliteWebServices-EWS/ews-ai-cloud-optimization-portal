import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildTestApp,
  httpRequest,
  identityHeaders,
  USER_PLATFORM_ADMIN,
  USER_TENANT_A_OWNER,
  TENANT_A,
  assertNoSecretsInPayload,
} from './tenant-administration/fixtures';
import { attachValidatedIdentityHeaders } from '../../lambda';
import { AppError } from '../../shared/utils';

function createTenantBody(slug: string, ownerUserId: string) {
  return {
    organizationName: 'Onboard Org',
    displayName: 'Onboard',
    slug,
    ownerUserId,
    primaryContact: { name: 'Owner', email: 'owner@example.com' },
    region: 'us-east-1',
    subscriptionPlan: 'standard',
  };
}

describe('Tenant onboarding HTTP integration', () => {
  it('rejects client-supplied tenantId on create', async () => {
    const ctx = buildTestApp();

    const response = await httpRequest(ctx.app, 'POST', '/api/v1/admin/tenants', {
      headers: identityHeaders({
        userId: USER_PLATFORM_ADMIN,
        groups: ['admin'],
        tenantId: TENANT_A,
        sessionMfaVerified: true,
      }),
      body: {
        ...createTenantBody('reject-tenant-id', USER_TENANT_A_OWNER),
        tenantId: 'client-tenant-id',
      },
    });

    assert.equal(response.status, 400);
  });

  it('Cognito failure leaves tenant PROVISIONING and returns sanitized error', async () => {
    const ctx = buildTestApp();
    ctx.cognitoAlignment.failWith = new AppError(
      'COGNITO_ALIGNMENT_FAILED',
      'Cognito tenant identity assignment failed.',
      503,
      'tenant-onboarding',
    );

    const response = await httpRequest(ctx.app, 'POST', '/api/v1/admin/tenants', {
      headers: identityHeaders({
        userId: USER_PLATFORM_ADMIN,
        groups: ['admin'],
        tenantId: TENANT_A,
        sessionMfaVerified: true,
      }),
      body: createTenantBody('cognito-fail-slug', USER_TENANT_A_OWNER),
    });

    assert.equal(response.status, 503);
    const tenants = await ctx.tenantRepository.listAll();
    assert.equal(tenants.items[0]?.status, 'PROVISIONING');
    assertNoSecretsInPayload(response.rawBody);
  });

  it('retry complete-onboarding activates PROVISIONING tenant', async () => {
    const ctx = buildTestApp();
    ctx.cognitoAlignment.failWith = new AppError(
      'COGNITO_ALIGNMENT_FAILED',
      'fail once',
      503,
      'tenant-onboarding',
    );

    await httpRequest(ctx.app, 'POST', '/api/v1/admin/tenants', {
      headers: identityHeaders({
        userId: USER_PLATFORM_ADMIN,
        groups: ['admin'],
        tenantId: TENANT_A,
        sessionMfaVerified: true,
      }),
      body: createTenantBody('retry-onboard-slug', USER_TENANT_A_OWNER),
    });

    const provisioning = (await ctx.tenantRepository.listAll()).items[0]!;
    ctx.cognitoAlignment.failWith = null;

    const retry = await httpRequest(
      ctx.app,
      'POST',
      `/api/v1/admin/tenants/${provisioning.tenantId}/complete-onboarding`,
      {
        headers: identityHeaders({
          userId: USER_PLATFORM_ADMIN,
          groups: ['admin'],
          tenantId: TENANT_A,
          sessionMfaVerified: true,
        }),
        body: {},
      },
    );

    assert.equal(retry.status, 200);
    assert.equal(
      (retry.body as { data: { tenant: { status: string } } }).data.tenant.status,
      'ACTIVE',
    );
    assert.equal(
      ctx.cognitoAlignment.assignments.get(USER_TENANT_A_OWNER),
      provisioning.tenantId,
    );
  });

  it('end-to-end: onboard → owner JWT tenant_id → bootstrap-owner 201', async () => {
    const ctx = buildTestApp();

    const created = await httpRequest(ctx.app, 'POST', '/api/v1/admin/tenants', {
      headers: identityHeaders({
        userId: USER_PLATFORM_ADMIN,
        groups: ['admin'],
        tenantId: TENANT_A,
        sessionMfaVerified: true,
      }),
      body: createTenantBody(`e2e-onboard-${Date.now()}`, USER_PLATFORM_ADMIN),
    });

    assert.equal(created.status, 201);
    const tenantId = (created.body as { data: { tenant: { tenantId: string } } }).data
      .tenant.tenantId;

    const event = {
      headers: {},
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              sub: USER_PLATFORM_ADMIN,
              'cognito:groups': 'admin',
              token_use: 'access',
              tenant_id: tenantId,
              mfa_session_verified: 'true',
            },
          },
        },
      },
    } as unknown as Parameters<typeof attachValidatedIdentityHeaders>[0];

    attachValidatedIdentityHeaders(event);

    const bootstrap = await httpRequest(
      ctx.app,
      'POST',
      '/api/v1/tenants/bootstrap-owner',
      {
        headers: {
          ...(event.headers as Record<string, string>),
          'content-type': 'application/json',
        },
        body: {},
      },
    );

    assert.equal(bootstrap.status, 201);
  });

  it('denies complete-onboarding for SUSPENDED tenant', async () => {
    const ctx = buildTestApp();
    const created = await ctx.tenantRepository.create({
      ...createTenantBody('suspended-onboard', USER_TENANT_A_OWNER),
      tenantId: 'tenant-suspended-onboard',
      status: 'PROVISIONING',
    });
    const active = await ctx.tenantRepository.transitionStatus(
      created.tenantId,
      'ACTIVE',
      { expectedVersion: created.version },
    );
    await ctx.tenantRepository.transitionStatus(created.tenantId, 'SUSPENDED', {
      expectedVersion: active.version,
    });

    const response = await httpRequest(
      ctx.app,
      'POST',
      `/api/v1/admin/tenants/${created.tenantId}/complete-onboarding`,
      {
        headers: identityHeaders({
          userId: USER_PLATFORM_ADMIN,
          groups: ['admin'],
          tenantId: TENANT_A,
          sessionMfaVerified: true,
        }),
        body: {},
      },
    );

    assert.equal(response.status, 409);
  });
});
