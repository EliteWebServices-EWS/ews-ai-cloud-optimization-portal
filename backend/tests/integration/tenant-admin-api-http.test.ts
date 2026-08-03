import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { createTenantAdminRoutes } from '../../api/routes/tenant-admin.routes';
import { createMembershipRoutes } from '../../api/routes/membership-routes';
import { MockTenantRepository } from '../../repositories/mock/mock-tenant-repository';
import {
  InMemoryInvitationRepository,
  InMemoryMembershipRepository,
} from '../../membership/membership.store';
import { createMembershipService } from '../../membership/membership.service';
import { createIdentitySourceMiddleware } from '../../auth/identity-source';
import {
  InMemoryCognitoIdentityAlignment,
} from '../../cognito/cognito-identity-alignment';
import {
  createTenantOnboardingService,
} from '../../services/tenant-onboarding.service';

/**
 * Sprint 12 / Engineer 4 — Task 1 (route-level coverage) and Task 4
 * (cross-tenant access, "No cross-tenant privilege escalation").
 *
 * Confirmed gap: every other test in this repo (unit and integration) calls
 * services/repositories directly. Nothing exercises the actual Express
 * routes (tenant-admin.routes.ts, membership-routes.ts) through a real
 * HTTP request/response cycle -- which means authorization middleware,
 * the safe-404 tenant isolation pattern, and audit-triggering error paths
 * were only ever tested indirectly.
 *
 * Follows the same house pattern as tests/unit/cors.test.ts: a real
 * express app on an ephemeral port, real fetch() calls, no supertest
 * dependency added.
 *
 * Identity is simulated via trusted internal x-sisum-* headers (see
 * getAuthenticatedIdentity), with createIdentitySourceMiddleware('lambda-adapter')
 * matching Sprint 12 tenant-administration/fixtures.ts. Privileged operations
 * require sessionMfaVerified (x-sisum-mfa-session-verified: true).
 */

interface Identity {
  authenticated?: boolean;
  userId?: string;
  email?: string;
  groups?: string[];
  tenantId?: string;
  sessionMfaVerified?: boolean;
}

function identityHeaders(identity: Identity): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };

  if (identity.authenticated !== false) {
    headers['x-sisum-authenticated'] = 'true';
    headers['x-sisum-token-use'] = 'access';
    headers['x-sisum-client-id'] = 'test-client';
  }
  if (identity.userId) headers['x-sisum-user-id'] = identity.userId;
  if (identity.email) {
    headers['x-sisum-user-email'] = identity.email;
  } else if (identity.userId) {
    headers['x-sisum-user-email'] = `${identity.userId}@example.com`;
  }
  if (identity.groups) headers['x-sisum-user-groups'] = identity.groups.join(',');
  if (identity.tenantId) headers['x-sisum-tenant-id'] = identity.tenantId;
  if (identity.sessionMfaVerified) {
    headers['x-sisum-mfa-session-verified'] = 'true';
  }

  return headers;
}

function platformAdminIdentity(sessionMfaVerified = false): Identity {
  return {
    authenticated: true,
    userId: 'platform-admin-1',
    groups: ['admin'],
    tenantId: 'sisum-default',
    sessionMfaVerified,
  };
}

function tenantPrivilegedIdentity(
  userId: string,
  tenantId: string,
  sessionMfaVerified = false,
): Identity {
  return {
    authenticated: true,
    userId,
    groups: ['admin'],
    tenantId,
    sessionMfaVerified,
  };
}

function buildApp(deps: {
  tenantRepository: MockTenantRepository;
  membershipRepository: InMemoryMembershipRepository;
  invitationRepository: InMemoryInvitationRepository;
}) {
  const app = express();
  app.use(express.json());
  app.use(createIdentitySourceMiddleware('lambda-adapter'));

  const membershipService = createMembershipService({
    membershipRepository: deps.membershipRepository,
    invitationRepository: deps.invitationRepository,
  });

  const cognitoAlignment = new InMemoryCognitoIdentityAlignment();
  const tenantOnboardingService = createTenantOnboardingService({
    tenantRepository: deps.tenantRepository,
    cognitoAlignment,
  });

  app.use(
    createTenantAdminRoutes({
      tenantRepository: deps.tenantRepository,
      tenantOnboardingService,
    }),
  );
  app.use(
    createMembershipRoutes({
      membershipService,
      membershipRepository: deps.membershipRepository,
    }),
  );

  return app;
}

async function withServer<T>(
  app: express.Application,
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }

  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function call(
  baseUrl: string,
  method: string,
  path: string,
  identity: Identity,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: identityHeaders(identity),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

function buildTenantInput(overrides: Partial<Parameters<MockTenantRepository['create']>[0]> = {}) {
  return {
    tenantId: 'tenant-http-a',
    organizationName: 'HTTP Test Org',
    displayName: 'HTTP Test Org',
    slug: 'http-test-org',
    ownerUserId: 'owner-a',
    primaryContact: { name: 'Owner A', email: 'owner-a@example.com' },
    status: 'ACTIVE' as const,
    region: 'us-east-1',
    subscriptionPlan: 'enterprise',
    ...overrides,
  };
}

describe('Tenant Administration API — HTTP integration', () => {
  it('POST /admin/tenants: platform admin can create a tenant (201)', async () => {
    const tenantRepository = new MockTenantRepository();
    const app = buildApp({
      tenantRepository,
      membershipRepository: new InMemoryMembershipRepository(),
      invitationRepository: new InMemoryInvitationRepository(),
    });

    await withServer(app, async (baseUrl) => {
      const res = await call(baseUrl, 'POST', '/admin/tenants',
        platformAdminIdentity(true),
        {
          organizationName: 'New Co',
          displayName: 'New Co',
          slug: 'new-co',
          ownerUserId: 'owner-new',
          primaryContact: { name: 'Owner New', email: 'owner-new@example.com' },
          region: 'us-east-1',
          subscriptionPlan: 'starter',
        },
      );

      assert.equal(res.status, 201);
      assert.equal(res.body.data.tenant.slug, 'new-co');
      assert.equal(res.body.data.tenant.status, 'ACTIVE');
      assert.equal(res.body.data.reauthenticationRequired, true);
    });
  });

  it('POST /admin/tenants: a non-admin (analyst) is rejected with 403, tenant not created', async () => {
    const tenantRepository = new MockTenantRepository();
    const app = buildApp({
      tenantRepository,
      membershipRepository: new InMemoryMembershipRepository(),
      invitationRepository: new InMemoryInvitationRepository(),
    });

    await withServer(app, async (baseUrl) => {
      const res = await call(baseUrl, 'POST', '/admin/tenants',
        { authenticated: true, userId: 'analyst-1', groups: ['analyst'] },
        { organizationName: 'Should Not Exist', displayName: 'x', slug: 'nope', ownerUserId: 'u', primaryContact: { name: 'a', email: 'a@example.com' }, region: 'us-east-1', subscriptionPlan: 'starter' },
      );

      assert.equal(res.status, 403);
    });

    const created = await tenantRepository.getBySlug('nope');
    assert.equal(created, undefined, 'a rejected create request must not create a tenant');
  });

  it('POST /admin/tenants: unauthenticated request is rejected with 401', async () => {
    const tenantRepository = new MockTenantRepository();
    const app = buildApp({
      tenantRepository,
      membershipRepository: new InMemoryMembershipRepository(),
      invitationRepository: new InMemoryInvitationRepository(),
    });

    await withServer(app, async (baseUrl) => {
      const res = await call(baseUrl, 'POST', '/admin/tenants', { authenticated: false }, {});
      assert.equal(res.status, 401);
    });
  });

  it('GET /admin/tenants/:id: the tenant owner can read their own tenant (200)', async () => {
    const tenantRepository = new MockTenantRepository();
    await tenantRepository.create(buildTenantInput());
    const app = buildApp({
      tenantRepository,
      membershipRepository: new InMemoryMembershipRepository(),
      invitationRepository: new InMemoryInvitationRepository(),
    });

    await withServer(app, async (baseUrl) => {
      const res = await call(baseUrl, 'GET', '/admin/tenants/tenant-http-a',
        { authenticated: true, userId: 'owner-a', groups: ['viewer'], tenantId: 'tenant-http-a' },
      );
      assert.equal(res.status, 200);
      assert.equal(res.body.data.tenantId, 'tenant-http-a');
    });
  });

  it('GET /admin/tenants/:id: an unrelated authenticated user of a DIFFERENT tenant gets a safe 404, not 403 (no cross-tenant existence disclosure)', async () => {
    const tenantRepository = new MockTenantRepository();
    await tenantRepository.create(buildTenantInput());
    const app = buildApp({
      tenantRepository,
      membershipRepository: new InMemoryMembershipRepository(),
      invitationRepository: new InMemoryInvitationRepository(),
    });

    await withServer(app, async (baseUrl) => {
      // Authenticated, but their trusted tenant claim is a completely different tenant,
      // and they hold no owner/admin relationship to tenant-http-a.
      const res = await call(baseUrl, 'GET', '/admin/tenants/tenant-http-a',
        { authenticated: true, userId: 'stranger-1', groups: ['viewer'], tenantId: 'tenant-http-b' },
      );
      assert.equal(res.status, 404, 'cross-tenant access must return the same safe 404 as a genuinely missing tenant');
    });
  });

  it('PATCH /admin/tenants/:id: rejects a stale version with 409 (optimistic concurrency)', async () => {
    const tenantRepository = new MockTenantRepository();
    const tenant = await tenantRepository.create(buildTenantInput());
    const app = buildApp({
      tenantRepository,
      membershipRepository: new InMemoryMembershipRepository(),
      invitationRepository: new InMemoryInvitationRepository(),
    });

    await withServer(app, async (baseUrl) => {
      const identity = { authenticated: true, userId: 'owner-a', groups: ['admin'], tenantId: 'tenant-http-a' };

      const first = await call(baseUrl, 'PATCH', '/admin/tenants/tenant-http-a', identity, {
        displayName: 'Renamed Once',
        version: tenant.version,
      });
      assert.equal(first.status, 200);

      // Retry with the now-stale original version.
      const stale = await call(baseUrl, 'PATCH', '/admin/tenants/tenant-http-a', identity, {
        displayName: 'Renamed Twice',
        version: tenant.version,
      });
      assert.equal(stale.status, 409);
    });
  });

  it('GET /admin/tenants (list): platform admin only', async () => {
    const tenantRepository = new MockTenantRepository();
    await tenantRepository.create(buildTenantInput());
    const app = buildApp({
      tenantRepository,
      membershipRepository: new InMemoryMembershipRepository(),
      invitationRepository: new InMemoryInvitationRepository(),
    });

    await withServer(app, async (baseUrl) => {
      const asAdmin = await call(baseUrl, 'GET', '/admin/tenants',
        { authenticated: true, userId: 'platform-admin-1', groups: ['admin'] },
      );
      assert.equal(asAdmin.status, 200);
      assert.ok(Array.isArray(asAdmin.body.data.tenants));

      const asViewer = await call(baseUrl, 'GET', '/admin/tenants',
        { authenticated: true, userId: 'viewer-1', groups: ['viewer'] },
      );
      assert.equal(asViewer.status, 403);
    });
  });
});

describe('Membership API — HTTP integration', () => {
  it('invite -> accept -> role change happy path through real HTTP routes', async () => {
    const tenantRepository = new MockTenantRepository();
    const membershipRepository = new InMemoryMembershipRepository();
    const invitationRepository = new InMemoryInvitationRepository();
    await tenantRepository.create(buildTenantInput());

    // Seed the tenant owner's own membership record directly -- this is the
    // legitimate bootstrap step every tenant needs (someone has to be the
    // first tenant_owner before they can invite anyone else through the API).
    await membershipRepository.create({
      tenantId: 'tenant-http-a',
      userId: 'owner-a',
      memberId: 'mem-owner-a',
      role: 'tenant_owner',
      status: 'ACTIVE',
      joinedAt: new Date().toISOString(),
      statusChangedAt: new Date().toISOString(),
    });

    const app = buildApp({ tenantRepository, membershipRepository, invitationRepository });
    const ownerIdentity = tenantPrivilegedIdentity('owner-a', 'tenant-http-a', true);

    await withServer(app, async (baseUrl) => {
      const invite = await call(baseUrl, 'POST', '/tenants/tenant-http-a/invite', ownerIdentity, {
        email: 'new-hire@example.com',
        role: 'analyst',
      });
      assert.equal(invite.status, 201);
      assert.ok(invite.body.data.token, 'raw token must be returned on invite');
      assert.equal(invite.body.data.invitation.status, 'PENDING');

      const accept = await call(baseUrl, 'POST', '/invitations/accept',
        { authenticated: true, userId: 'new-hire-1', tenantId: 'tenant-http-a' },
        { token: invite.body.data.token },
      );
      assert.equal(accept.status, 200);
      assert.equal(accept.body.data.member.role, 'analyst');
      assert.equal(accept.body.data.member.status, 'ACTIVE');

      const memberId = accept.body.data.member.memberId;
      const promote = await call(baseUrl, 'PATCH', `/members/${memberId}`, ownerIdentity, {
        role: 'tenant_admin',
        expectedVersion: accept.body.data.member.version,
      });
      assert.equal(promote.status, 200);
      assert.equal(promote.body.data.member.role, 'tenant_admin');
    });
  });

  it('cross-tenant privilege escalation is blocked: a Tenant B admin cannot modify a Tenant A member (safe 404)', async () => {
    const tenantRepository = new MockTenantRepository();
    const membershipRepository = new InMemoryMembershipRepository();
    const invitationRepository = new InMemoryInvitationRepository();

    await tenantRepository.create(buildTenantInput({ tenantId: 'tenant-http-a', slug: 'http-test-org-a' }));
    await tenantRepository.create(buildTenantInput({
      tenantId: 'tenant-http-b',
      slug: 'http-test-org-b',
      ownerUserId: 'owner-b',
      primaryContact: { name: 'Owner B', email: 'owner-b@example.com' },
    }));

    // A real member of Tenant A, whose memberId a Tenant B admin will try to touch.
    const victimMember = await membershipRepository.create({
      tenantId: 'tenant-http-a',
      userId: 'victim-user',
      memberId: 'mem-victim',
      role: 'analyst',
      status: 'ACTIVE',
      joinedAt: new Date().toISOString(),
      statusChangedAt: new Date().toISOString(),
    });

    // A legitimate tenant_owner of Tenant B -- correctly privileged, but only within B.
    await membershipRepository.create({
      tenantId: 'tenant-http-b',
      userId: 'owner-b',
      memberId: 'mem-owner-b',
      role: 'tenant_owner',
      status: 'ACTIVE',
      joinedAt: new Date().toISOString(),
      statusChangedAt: new Date().toISOString(),
    });

    const app = buildApp({ tenantRepository, membershipRepository, invitationRepository });

    await withServer(app, async (baseUrl) => {
      const res = await call(baseUrl, 'PATCH', `/members/${victimMember.memberId}`,
        { authenticated: true, userId: 'owner-b', groups: ['admin'], tenantId: 'tenant-http-b' },
        { role: 'tenant_owner' }, // attempted privilege escalation against a foreign tenant's member
      );

      assert.equal(res.status, 404, 'a Tenant B admin must not be able to see or modify a Tenant A member');
    });

    // Confirm the victim's record was genuinely untouched.
    const unchanged = await membershipRepository.get('tenant-http-a', 'victim-user');
    assert.equal(unchanged?.role, 'analyst');
  });
});