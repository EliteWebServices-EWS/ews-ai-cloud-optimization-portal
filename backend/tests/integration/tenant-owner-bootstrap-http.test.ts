import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  USER_PLATFORM_ADMIN,
  TENANT_A,
  buildTestApp,
  httpRequest,
  identityHeaders,
  seedActiveTenant,
  seedTenantMembership,
} from './tenant-administration/fixtures';

const BOOTSTRAP_PATH = '/api/v1/tenants/bootstrap-owner';

function platformAdmin(overrides: {
  tenantId?: string;
  sessionMfaVerified?: boolean;
  userId?: string;
  groups?: string[];
} = {}) {
  return identityHeaders({
    userId: overrides.userId ?? USER_PLATFORM_ADMIN,
    groups: (overrides.groups ?? ['admin']) as never,
    tenantId: overrides.tenantId ?? TENANT_A,
    sessionMfaVerified: overrides.sessionMfaVerified ?? true,
  });
}

async function seedBootstrapTenant(
  ctx: ReturnType<typeof buildTestApp>,
  tenantId: string,
) {
  await seedActiveTenant(ctx.tenantRepository, {
    tenantId,
    slug: `${tenantId}-slug`,
    ownerUserId: 'registry-placeholder',
  });
}

describe('POST /api/v1/tenants/bootstrap-owner', () => {
  it('platform admin bootstraps first tenant_owner (201)', async () => {
    const ctx = buildTestApp();
    await seedBootstrapTenant(ctx, TENANT_A);

    const response = await httpRequest(ctx.app, 'POST', BOOTSTRAP_PATH, {
      headers: platformAdmin({ tenantId: TENANT_A }),
      body: {},
    });

    assert.equal(response.status, 201);
    const member = (response.body as { data: { member: Record<string, unknown> } }).data.member;
    assert.equal(member.tenantId, TENANT_A);
    assert.equal(member.userId, USER_PLATFORM_ADMIN);
    assert.equal(member.role, 'tenant_owner');
    assert.equal(member.status, 'ACTIVE');
    assert.equal(member.version, 1);
    assert.equal(JSON.stringify(response.body).includes('x-sisum'), false);
  });

  it('rejects caller-supplied tenantId, userId, and role in body (400)', async () => {
    const ctx = buildTestApp();
    await seedBootstrapTenant(ctx, TENANT_A);

    for (const body of [
      { tenantId: 'other-tenant' },
      { userId: 'other-user' },
      { role: 'tenant_owner' },
      { memberId: 'mem-evil' },
      { addedBy: 'evil' },
    ]) {
      const response = await httpRequest(ctx.app, 'POST', BOOTSTRAP_PATH, {
        headers: platformAdmin({ tenantId: TENANT_A }),
        body,
      });
      assert.equal(response.status, 400, JSON.stringify(body));
    }
  });

  it('returns 403 for non-admin and 401 for unauthenticated callers', async () => {
    const ctx = buildTestApp();
    await seedBootstrapTenant(ctx, TENANT_A);

    const viewer = await httpRequest(ctx.app, 'POST', BOOTSTRAP_PATH, {
      headers: identityHeaders({
        userId: 'viewer-1',
        groups: ['viewer'],
        tenantId: TENANT_A,
        sessionMfaVerified: true,
      }),
      body: {},
    });
    assert.equal(viewer.status, 403);

    const unauth = await httpRequest(ctx.app, 'POST', BOOTSTRAP_PATH, {
      headers: { 'content-type': 'application/json' },
      body: {},
    });
    assert.equal(unauth.status, 401);
  });

  it('returns 403 when privileged MFA evidence is missing', async () => {
    const ctx = buildTestApp();
    await seedBootstrapTenant(ctx, TENANT_A);

    const response = await httpRequest(ctx.app, 'POST', BOOTSTRAP_PATH, {
      headers: platformAdmin({ tenantId: TENANT_A, sessionMfaVerified: false }),
      body: {},
    });

    assert.equal(response.status, 403);
    const body = response.body as { error: { code: string } };
    assert.equal(body.error.code, 'MFA_EVIDENCE_UNAVAILABLE');
  });

  it('returns 409 on second bootstrap attempt', async () => {
    const ctx = buildTestApp();
    await seedBootstrapTenant(ctx, TENANT_A);
    const headers = platformAdmin({ tenantId: TENANT_A });

    const first = await httpRequest(ctx.app, 'POST', BOOTSTRAP_PATH, { headers, body: {} });
    assert.equal(first.status, 201);

    const second = await httpRequest(ctx.app, 'POST', BOOTSTRAP_PATH, { headers, body: {} });
    assert.equal(second.status, 409);
    assert.equal(
      (second.body as { error: { code: string } }).error.code,
      'TENANT_OWNER_ALREADY_BOOTSTRAPPED',
    );
  });

  for (const status of ['ACTIVE', 'PENDING', 'SUSPENDED'] as const) {
    it(`returns 409 when legacy ${status} membership exists without bootstrap marker`, async () => {
      const ctx = buildTestApp();
      const tenantId = `tenant-legacy-${status.toLowerCase()}`;
      await seedBootstrapTenant(ctx, tenantId);
      await seedTenantMembership(ctx.membershipRepository, {
        tenantId,
        userId: 'legacy-member',
        role: 'viewer',
        status,
      });

      const auditLines: string[] = [];
      const originalWarn = console.warn;
      console.warn = ((message?: unknown) => {
        auditLines.push(String(message));
        originalWarn(message);
      }) as typeof console.warn;

      try {
        const response = await httpRequest(ctx.app, 'POST', BOOTSTRAP_PATH, {
          headers: platformAdmin({ tenantId }),
          body: {},
        });

        assert.equal(response.status, 409);
        assert.equal(
          (response.body as { error: { code: string } }).error.code,
          'TENANT_OWNER_ALREADY_BOOTSTRAPPED',
        );
        assert.equal(response.rawBody.includes('legacy-member'), false);
        assert.ok(
          auditLines.some((line) => line.includes('tenant.owner_bootstrap_denied')),
        );
      } finally {
        console.warn = originalWarn;
      }
    });
  }

  it('returns 404 when tenant registry record does not exist', async () => {
    const ctx = buildTestApp();

    const response = await httpRequest(ctx.app, 'POST', BOOTSTRAP_PATH, {
      headers: platformAdmin({ tenantId: 'tenant-missing-registry' }),
      body: {},
    });

    assert.equal(response.status, 404);
  });

  it('returns 404 when tenant is DELETED', async () => {
    const ctx = buildTestApp();
    const tenantId = 'tenant-deleted-bootstrap';
    const created = await ctx.tenantRepository.create({
      tenantId,
      organizationName: 'Org',
      displayName: 'Display',
      slug: 'deleted-bootstrap-slug',
      ownerUserId: 'owner',
      primaryContact: { name: 'Contact', email: 'c@example.com' },
      region: 'us-east-1',
      subscriptionPlan: 'standard',
      status: 'PROVISIONING',
    });
    await ctx.tenantRepository.transitionStatus(tenantId, 'ACTIVE', {
      expectedVersion: created.version,
    });
    const active = await ctx.tenantRepository.getById(tenantId);
    await ctx.tenantRepository.transitionStatus(tenantId, 'ARCHIVED', {
      expectedVersion: active!.version,
    });
    const archived = await ctx.tenantRepository.getById(tenantId);
    await ctx.tenantRepository.transitionStatus(tenantId, 'DELETED', {
      expectedVersion: archived!.version,
    });

    const response = await httpRequest(ctx.app, 'POST', BOOTSTRAP_PATH, {
      headers: platformAdmin({ tenantId }),
      body: {},
    });

    assert.equal(response.status, 404);
  });

  it('returns 409 when tenant is SUSPENDED in registry', async () => {
    const ctx = buildTestApp();
    const tenantId = 'tenant-suspended-bootstrap';
    const created = await ctx.tenantRepository.create({
      tenantId,
      organizationName: 'Org',
      displayName: 'Display',
      slug: 'suspended-bootstrap-slug',
      ownerUserId: 'owner',
      primaryContact: { name: 'Contact', email: 'c@example.com' },
      region: 'us-east-1',
      subscriptionPlan: 'standard',
      status: 'PROVISIONING',
    });
    await ctx.tenantRepository.transitionStatus(tenantId, 'ACTIVE', {
      expectedVersion: created.version,
    });
    const active = await ctx.tenantRepository.getById(tenantId);
    await ctx.tenantRepository.transitionStatus(tenantId, 'SUSPENDED', {
      expectedVersion: active!.version,
    });

    const response = await httpRequest(ctx.app, 'POST', BOOTSTRAP_PATH, {
      headers: platformAdmin({ tenantId }),
      body: {},
    });

    assert.equal(response.status, 409);
    assert.equal(
      (response.body as { error: { code: string } }).error.code,
      'TENANT_NOT_BOOTSTRAPPABLE',
    );
  });

  it('concurrent bootstrap requests produce exactly one success', async () => {
    const ctx = buildTestApp();
    const tenantId = 'tenant-concurrent-bootstrap';
    await seedBootstrapTenant(ctx, tenantId);
    const headers = platformAdmin({ tenantId });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        httpRequest(ctx.app, 'POST', BOOTSTRAP_PATH, { headers, body: {} }),
      ),
    );

    const successes = results.filter((response) => response.status === 201);
    const conflicts = results.filter((response) => response.status === 409);

    assert.equal(successes.length, 1);
    assert.equal(conflicts.length, 4);
  });

  it('after bootstrap, tenant_owner can register an AWS account', async () => {
    const ctx = buildTestApp();
    const tenantId = 'tenant-aws-after-bootstrap';
    await seedBootstrapTenant(ctx, tenantId);

    const bootstrap = await httpRequest(ctx.app, 'POST', BOOTSTRAP_PATH, {
      headers: platformAdmin({ tenantId, userId: USER_PLATFORM_ADMIN }),
      body: {},
    });
    assert.equal(bootstrap.status, 201);

    const register = await httpRequest(
      ctx.app,
      'POST',
      '/api/v1/aws-accounts',
      {
        headers: platformAdmin({ tenantId, userId: USER_PLATFORM_ADMIN }),
        body: {
          accountId: '111122223333',
          roleArn: 'arn:aws:iam::111122223333:role/SisumReadOnly',
          region: 'us-east-1',
        },
      },
    );

    assert.equal(register.status, 201);
  });
});
