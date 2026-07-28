import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildTestApp,
  httpRequest,
  identityHeaders,
  seedActiveTenant,
  seedTenantMembership,
  TENANT_A,
  USER_PLATFORM_ADMIN,
  USER_TENANT_A_OWNER,
} from './fixtures';

describe('Validation matrix — concurrency and conflicts', () => {
  it('tenant concurrent updates: exactly one succeeds on stale version', async () => {
    const ctx = buildTestApp();
    const tenant = await seedActiveTenant(ctx.tenantRepository, {
      tenantId: TENANT_A,
      slug: 'concurrent',
      ownerUserId: USER_TENANT_A_OWNER,
    });

    const headers = identityHeaders({
      userId: USER_TENANT_A_OWNER,
      groups: ['admin'],
      tenantId: TENANT_A,
    });

    const results = await Promise.allSettled([
      httpRequest(ctx.app, 'PATCH', `/api/v1/admin/tenants/${TENANT_A}`, {
        headers,
        body: { displayName: 'Concurrent A', version: tenant.version },
      }),
      httpRequest(ctx.app, 'PATCH', `/api/v1/admin/tenants/${TENANT_A}`, {
        headers,
        body: { displayName: 'Concurrent B', version: tenant.version },
      }),
    ]);

    const statuses = results.map((result) =>
      result.status === 'fulfilled' ? result.value.status : 0,
    );

    assert.equal(statuses.filter((code) => code === 200).length, 1);
    assert.equal(statuses.filter((code) => code === 409).length, 1);

    const latest = await ctx.tenantRepository.getById(TENANT_A);
    assert.ok(latest);
    assert.equal(latest!.version, tenant.version + 1);
  });

  it('duplicate tenant slug returns safe 409', async () => {
    const ctx = buildTestApp();
    await seedActiveTenant(ctx.tenantRepository, {
      tenantId: TENANT_A,
      slug: 'unique-slug',
      ownerUserId: USER_TENANT_A_OWNER,
    });

    const response = await httpRequest(ctx.app, 'POST', '/api/v1/admin/tenants', {
      headers: identityHeaders({
        userId: USER_PLATFORM_ADMIN,
        groups: ['admin'],
        tenantId: TENANT_A,
        sessionMfaVerified: true,
      }),
      body: {
        organizationName: 'Other Org',
        displayName: 'Other',
        slug: 'unique-slug',
        ownerUserId: USER_TENANT_A_OWNER,
        primaryContact: { name: 'C', email: 'c@example.com' },
        region: 'us-east-1',
        subscriptionPlan: 'standard',
      },
    });

    assert.equal(response.status, 409);
    assert.doesNotMatch(response.rawBody, /ConditionalCheckFailed/i);
  });
});

describe('Security abuse cases (subset)', () => {
  it('real-world Cognito access token (no amr) cannot create tenant', async () => {
    const { app } = buildTestApp();

    const response = await httpRequest(app, 'POST', '/api/v1/admin/tenants', {
      headers: {
        'content-type': 'application/json',
        'x-sisum-authenticated': 'true',
        'x-sisum-user-id': USER_PLATFORM_ADMIN,
        'x-sisum-user-groups': 'admin',
        'x-sisum-tenant-id': 'sisum-default',
        'x-sisum-token-use': 'access',
      },
      body: {
        organizationName: 'Real Cognito Shape',
        displayName: 'Real',
        slug: 'real-cognito-token',
        ownerUserId: USER_TENANT_A_OWNER,
        primaryContact: { name: 'C', email: 'c@example.com' },
        region: 'us-east-1',
        subscriptionPlan: 'standard',
      },
    });

    assert.equal(response.status, 403);
    assert.match(response.rawBody, /MFA_EVIDENCE_UNAVAILABLE/);
  });

  it('ignores spoofed MFA headers without mfa_session_verified', async () => {
    const { app } = buildTestApp();
    const headers = identityHeaders({
      userId: USER_PLATFORM_ADMIN,
      groups: ['admin'],
      tenantId: TENANT_A,
    });
    headers['x-mfa-verified'] = 'true';
    headers['x-sisum-auth-methods'] = 'pwd,software_token_mfa';

    const response = await httpRequest(app, 'POST', '/api/v1/admin/tenants', {
      headers,
      body: {
        organizationName: 'Spoof',
        displayName: 'Spoof',
        slug: 'spoof-mfa',
        ownerUserId: USER_TENANT_A_OWNER,
        primaryContact: { name: 'C', email: 'c@example.com' },
        region: 'us-east-1',
        subscriptionPlan: 'standard',
      },
    });

    assert.equal(response.status, 403);
    assert.match(response.rawBody, /MFA_EVIDENCE_UNAVAILABLE/);
  });

  it('spoofed x-tenant-id header does not override trusted tenant claim', async () => {
    const ctx = buildTestApp();
    await seedActiveTenant(ctx.tenantRepository, {
      tenantId: TENANT_A,
      slug: 'spoof-header',
      ownerUserId: USER_TENANT_A_OWNER,
    });

    await seedTenantMembership(ctx.membershipRepository, {
      tenantId: TENANT_A,
      userId: USER_TENANT_A_OWNER,
      role: 'tenant_owner',
    });

    const headers = identityHeaders({
      userId: USER_TENANT_A_OWNER,
      groups: ['admin'],
      tenantId: TENANT_A,
    });
    headers['x-tenant-id'] = 'tenant-attacker';

    const ok = await httpRequest(ctx.app, 'GET', `/api/v1/tenants/${TENANT_A}/members`, {
      headers,
    });

    assert.equal(ok.status, 200);

    const blocked = await httpRequest(ctx.app, 'GET', `/api/v1/tenants/tenant-attacker/members`, {
      headers,
    });

    assert.equal(blocked.status, 404);
  });
});
