import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildTestApp,
  httpRequest,
  identityHeaders,
  seedActiveTenant,
  seedTenantMembership,
  TENANT_A,
  TENANT_B,
  USER_PLATFORM_ADMIN,
  USER_TENANT_A_OWNER,
  USER_TENANT_B_OWNER,
  assertNoSecretsInPayload,
} from './fixtures';

function createTenantBody(slug: string, ownerUserId: string) {
  return {
    organizationName: 'Acme Organization',
    displayName: 'Acme',
    slug,
    ownerUserId,
    primaryContact: { name: 'Primary', email: 'primary@example.com' },
    region: 'us-east-1',
    subscriptionPlan: 'standard',
  };
}

describe('Tenant administration CRUD integration', () => {
  it('Platform Admin with sessionMfaVerified creates a tenant in PROVISIONING', async () => {
    const { app } = buildTestApp();

    const response = await httpRequest<{ data: { status: string; tenantId: string; version: number } }>(
      app,
      'POST',
      '/api/v1/admin/tenants',
      {
        headers: identityHeaders({
          userId: USER_PLATFORM_ADMIN,
          groups: ['admin'],
          tenantId: TENANT_A,
          sessionMfaVerified: true,
        }),
        body: createTenantBody('acme-new', USER_TENANT_A_OWNER),
      },
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.data.status, 'PROVISIONING');
    assert.ok(response.body.data.tenantId);
    assert.equal(response.body.data.version, 1);
    assertNoSecretsInPayload(response.rawBody);
  });

  it('Platform Admin without session MFA evidence cannot create a tenant', async () => {
    const { app } = buildTestApp();

    const response = await httpRequest(app, 'POST', '/api/v1/admin/tenants', {
      headers: identityHeaders({
        userId: USER_PLATFORM_ADMIN,
        groups: ['admin'],
        tenantId: TENANT_A,
      }),
      body: createTenantBody('no-mfa', USER_TENANT_A_OWNER),
    });

    assert.equal(response.status, 403);
    assert.match(response.rawBody, /MFA_EVIDENCE_UNAVAILABLE/);
  });

  it('authorized administrator retrieves and updates tenant metadata with version checks', async () => {
    const ctx = buildTestApp();
    const tenant = await seedActiveTenant(ctx.tenantRepository, {
      tenantId: TENANT_A,
      slug: 'tenant-a',
      ownerUserId: USER_TENANT_A_OWNER,
    });

    const getResponse = await httpRequest(appFrom(ctx), 'GET', `/api/v1/admin/tenants/${TENANT_A}`, {
      headers: identityHeaders({
        userId: USER_TENANT_A_OWNER,
        groups: ['admin'],
        tenantId: TENANT_A,
      }),
    });

    assert.equal(getResponse.status, 200);

    const patchResponse = await httpRequest(appFrom(ctx), 'PATCH', `/api/v1/admin/tenants/${TENANT_A}`, {
      headers: identityHeaders({
        userId: USER_TENANT_A_OWNER,
        groups: ['admin'],
        tenantId: TENANT_A,
      }),
      body: {
        displayName: 'Updated Display',
        version: tenant.version,
      },
    });

    assert.equal(patchResponse.status, 200);
    assert.equal((patchResponse.body as { data: { version: number } }).data.version, tenant.version + 1);

    const stale = await httpRequest(appFrom(ctx), 'PATCH', `/api/v1/admin/tenants/${TENANT_A}`, {
      headers: identityHeaders({
        userId: USER_TENANT_A_OWNER,
        groups: ['admin'],
        tenantId: TENANT_A,
      }),
      body: {
        displayName: 'Stale',
        version: tenant.version,
      },
    });

    assert.equal(stale.status, 409);
    assert.match(stale.rawBody, /CONFLICT/);
    assert.doesNotMatch(stale.rawBody, /ConditionalCheckFailed/i);
  });

  it('lifecycle suspend and reactivate with session MFA evidence on suspend', async () => {
    const ctx = buildTestApp();
    let tenant = await seedActiveTenant(ctx.tenantRepository, {
      tenantId: TENANT_A,
      slug: 'lifecycle-a',
      ownerUserId: USER_TENANT_A_OWNER,
    });

    const suspendDenied = await httpRequest(
      appFrom(ctx),
      'POST',
      `/api/v1/admin/tenants/${TENANT_A}/suspend`,
      {
        headers: identityHeaders({
          userId: USER_TENANT_A_OWNER,
          groups: ['admin'],
          tenantId: TENANT_A,
        }),
        body: { version: tenant.version },
      },
    );

    assert.equal(suspendDenied.status, 403);
    assert.match(suspendDenied.rawBody, /MFA_EVIDENCE_UNAVAILABLE/);

    const suspended = await httpRequest(
      appFrom(ctx),
      'POST',
      `/api/v1/admin/tenants/${TENANT_A}/suspend`,
      {
        headers: identityHeaders({
          userId: USER_TENANT_A_OWNER,
          groups: ['admin'],
          tenantId: TENANT_A,
          sessionMfaVerified: true,
        }),
        body: { version: tenant.version },
      },
    );

    assert.equal(suspended.status, 200);
    tenant = (suspended.body as { data: typeof tenant }).data;
    assert.equal(tenant.status, 'SUSPENDED');

    const reactivated = await httpRequest(
      appFrom(ctx),
      'POST',
      `/api/v1/admin/tenants/${TENANT_A}/reactivate`,
      {
        headers: identityHeaders({
          userId: USER_TENANT_A_OWNER,
          groups: ['admin'],
          tenantId: TENANT_A,
        }),
        body: { version: tenant.version },
      },
    );

    assert.equal(reactivated.status, 200);
    assert.equal((reactivated.body as { data: { status: string } }).data.status, 'ACTIVE');
  });

  it('cross-tenant administrator receives safe 404 on get', async () => {
    const ctx = buildTestApp();
    await seedActiveTenant(ctx.tenantRepository, {
      tenantId: TENANT_B,
      slug: 'tenant-b',
      ownerUserId: USER_TENANT_B_OWNER,
    });

    const response = await httpRequest(appFrom(ctx), 'GET', `/api/v1/admin/tenants/${TENANT_B}`, {
      headers: identityHeaders({
        userId: USER_TENANT_A_OWNER,
        groups: ['analyst'],
        tenantId: TENANT_A,
      }),
    });

    assert.equal(response.status, 404);
    assert.doesNotMatch(response.rawBody, new RegExp(TENANT_B, 'i'));
  });

  it('missing tenant returns safe 404', async () => {
    const { app } = buildTestApp();

    const response = await httpRequest(app, 'GET', '/api/v1/admin/tenants/missing-tenant-id', {
      headers: identityHeaders({
        userId: USER_PLATFORM_ADMIN,
        groups: ['admin'],
        tenantId: TENANT_A,
        sessionMfaVerified: true,
      }),
    });

    assert.equal(response.status, 404);
  });
});

function appFrom(ctx: ReturnType<typeof buildTestApp>) {
  return ctx.app;
}

describe('Tenant suspension characterization', () => {
  it('documents absence of global tenant-suspended request guard on membership list', async () => {
    const ctx = buildTestApp();
    const tenant = await seedActiveTenant(ctx.tenantRepository, {
      tenantId: TENANT_A,
      slug: 'suspended-char',
      ownerUserId: USER_TENANT_A_OWNER,
    });

    await ctx.tenantRepository.transitionStatus(TENANT_A, 'SUSPENDED', {
      expectedVersion: tenant.version,
    });

    await seedTenantMembership(ctx.membershipRepository, {
      tenantId: TENANT_A,
      userId: USER_TENANT_A_OWNER,
      role: 'tenant_owner',
    });

    const response = await httpRequest(appFrom(ctx), 'GET', `/api/v1/tenants/${TENANT_A}/members`, {
      headers: identityHeaders({
        userId: USER_TENANT_A_OWNER,
        groups: ['admin'],
        tenantId: TENANT_A,
      }),
    });

    // Known gap: no global guard yet — list still succeeds for authenticated tenant member.
    assert.equal(response.status, 200);
  });
});
