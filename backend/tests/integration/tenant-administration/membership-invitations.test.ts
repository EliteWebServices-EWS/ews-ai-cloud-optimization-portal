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
  USER_INVITEE,
  USER_TENANT_A_ADMIN,
  USER_TENANT_A_OWNER,
  USER_VIEWER,
  assertNoSecretsInPayload,
} from './fixtures';

describe('Membership and invitation integration', () => {
  it('tenant admin adds member with role and versioned update', async () => {
    const ctx = buildTestApp();
    await seedActiveTenant(ctx.tenantRepository, {
      tenantId: TENANT_A,
      slug: 'mem-a',
      ownerUserId: USER_TENANT_A_OWNER,
    });

    await seedTenantMembership(ctx.membershipRepository, {
      tenantId: TENANT_A,
      userId: USER_TENANT_A_ADMIN,
      role: 'tenant_admin',
    });

    const addResponse = await httpRequest(appFrom(ctx), 'POST', `/api/v1/tenants/${TENANT_A}/members`, {
      headers: identityHeaders({
        userId: USER_TENANT_A_ADMIN,
        groups: ['admin'],
        tenantId: TENANT_A,
      }),
      body: { userId: USER_VIEWER, role: 'viewer' },
    });

    assert.equal(addResponse.status, 201);
    const member = (addResponse.body as { data: { member: { memberId: string; version: number } } }).data.member;

    const patch = await httpRequest(appFrom(ctx), 'PATCH', `/api/v1/members/${member.memberId}`, {
      headers: identityHeaders({
        userId: USER_TENANT_A_ADMIN,
        groups: ['admin'],
        tenantId: TENANT_A,
      }),
      body: { role: 'analyst', expectedVersion: member.version },
    });

    assert.equal(patch.status, 200);
  });

  it('rejects duplicate membership', async () => {
    const ctx = buildTestApp();
    await seedActiveTenant(ctx.tenantRepository, {
      tenantId: TENANT_A,
      slug: 'dup-a',
      ownerUserId: USER_TENANT_A_OWNER,
    });

    await seedTenantMembership(ctx.membershipRepository, {
      tenantId: TENANT_A,
      userId: USER_TENANT_A_OWNER,
      role: 'tenant_owner',
    });

    const response = await httpRequest(appFrom(ctx), 'POST', `/api/v1/tenants/${TENANT_A}/members`, {
      headers: identityHeaders({
        userId: USER_TENANT_A_OWNER,
        groups: ['admin'],
        tenantId: TENANT_A,
      }),
      body: { userId: USER_VIEWER, role: 'viewer' },
    });

    assert.equal(response.status, 201);

    const duplicate = await httpRequest(appFrom(ctx), 'POST', `/api/v1/tenants/${TENANT_A}/members`, {
      headers: identityHeaders({
        userId: USER_TENANT_A_OWNER,
        groups: ['admin'],
        tenantId: TENANT_A,
      }),
      body: { userId: USER_VIEWER, role: 'viewer' },
    });

    assert.equal(duplicate.status, 409);
  });

  it('invitation lifecycle: create, accept once, block replay', async () => {
    const ctx = buildTestApp();
    await seedActiveTenant(ctx.tenantRepository, {
      tenantId: TENANT_A,
      slug: 'inv-a',
      ownerUserId: USER_TENANT_A_OWNER,
    });

    await seedTenantMembership(ctx.membershipRepository, {
      tenantId: TENANT_A,
      userId: USER_TENANT_A_OWNER,
      role: 'tenant_owner',
    });

    const invite = await httpRequest(appFrom(ctx), 'POST', `/api/v1/tenants/${TENANT_A}/invite`, {
      headers: identityHeaders({
        userId: USER_TENANT_A_OWNER,
        groups: ['admin'],
        tenantId: TENANT_A,
      }),
      body: { email: 'invitee@example.com', role: 'viewer' },
    });

    assert.equal(invite.status, 201);
    const inviteBody = invite.body as {
      data: { token: string; invitation: { status: string } };
    };
    const token = inviteBody.data.token;
    assert.equal(inviteBody.data.invitation.status, 'PENDING');
    assert.ok(token.length > 10);
    assertNoSecretsInPayload(JSON.stringify(inviteBody.data.invitation));

    const accept = await httpRequest(appFrom(ctx), 'POST', '/api/v1/invitations/accept', {
      headers: identityHeaders({
        userId: USER_INVITEE,
        groups: ['viewer'],
        tenantId: TENANT_A,
      }),
      body: { token },
    });

    assert.equal(accept.status, 200);

    const replay = await httpRequest(appFrom(ctx), 'POST', '/api/v1/invitations/accept', {
      headers: identityHeaders({
        userId: USER_INVITEE,
        groups: ['viewer'],
        tenantId: TENANT_A,
      }),
      body: { token },
    });

    assert.equal(replay.status, 409);
  });

  it('expired invitation cannot be accepted (deterministic timestamp)', async () => {
    const ctx = buildTestApp();
    await seedActiveTenant(ctx.tenantRepository, {
      tenantId: TENANT_A,
      slug: 'exp-inv',
      ownerUserId: USER_TENANT_A_OWNER,
    });

    await seedTenantMembership(ctx.membershipRepository, {
      tenantId: TENANT_A,
      userId: USER_TENANT_A_OWNER,
      role: 'tenant_owner',
    });

    const { createMembershipService } = await import('../../../membership/membership.service');
    const service = createMembershipService({
      membershipRepository: ctx.membershipRepository,
      invitationRepository: ctx.invitationRepository,
    });

    const { token } = await service.inviteMember({
      tenantId: TENANT_A,
      email: 'expired@example.com',
      role: 'viewer',
      invitedBy: USER_TENANT_A_OWNER,
    });

    const page = await ctx.invitationRepository.listByTenant(TENANT_A);
    const record = page.items[0];

    await ctx.invitationRepository.update(
      TENANT_A,
      record.invitationId,
      { expiresAtIso: new Date(Date.now() - 60_000).toISOString() },
      { expectedVersion: record.version },
    );

    const accept = await httpRequest(appFrom(ctx), 'POST', '/api/v1/invitations/accept', {
      headers: identityHeaders({
        userId: USER_INVITEE,
        groups: ['viewer'],
        tenantId: TENANT_A,
      }),
      body: { token },
    });

    assert.equal(accept.status, 409);
    assert.match(accept.rawBody, /expired|INVITATION/i);
  });

  it('tenant admin cannot assign tenant_owner without owner role', async () => {
    const ctx = buildTestApp();
    await seedActiveTenant(ctx.tenantRepository, {
      tenantId: TENANT_A,
      slug: 'role-a',
      ownerUserId: USER_TENANT_A_OWNER,
    });

    await seedTenantMembership(ctx.membershipRepository, {
      tenantId: TENANT_A,
      userId: USER_TENANT_A_ADMIN,
      role: 'tenant_admin',
    });

    const targetMember = await seedTenantMembership(ctx.membershipRepository, {
      tenantId: TENANT_A,
      userId: USER_VIEWER,
      role: 'viewer',
    });

    const member = await ctx.membershipRepository.getByMemberId(targetMember);

    const response = await httpRequest(appFrom(ctx), 'PATCH', `/api/v1/members/${targetMember}`, {
      headers: identityHeaders({
        userId: USER_TENANT_A_ADMIN,
        groups: ['admin'],
        tenantId: TENANT_A,
      }),
      body: { role: 'tenant_owner', expectedVersion: member!.version },
    });

    assert.equal(response.status, 403);
  });

  it('path tenant mismatch returns safe 404', async () => {
    const ctx = buildTestApp();
    await seedActiveTenant(ctx.tenantRepository, {
      tenantId: TENANT_A,
      slug: 'iso-a',
      ownerUserId: USER_TENANT_A_OWNER,
    });

    await seedTenantMembership(ctx.membershipRepository, {
      tenantId: TENANT_A,
      userId: USER_TENANT_A_OWNER,
      role: 'tenant_owner',
    });

    const response = await httpRequest(appFrom(ctx), 'GET', `/api/v1/tenants/${TENANT_B}/members`, {
      headers: identityHeaders({
        userId: USER_TENANT_A_OWNER,
        groups: ['admin'],
        tenantId: TENANT_A,
      }),
    });

    assert.equal(response.status, 404);
  });
});

function appFrom(ctx: ReturnType<typeof buildTestApp>) {
  return ctx.app;
}
