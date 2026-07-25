import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMembershipService } from '../../../membership/membership.service';
import {
  InMemoryInvitationRepository,
  InMemoryMembershipRepository,
} from '../../../membership/membership.store';
import { isAppError } from '../../../shared/utils';

function createService() {
  const membershipRepository = new InMemoryMembershipRepository();
  const invitationRepository = new InMemoryInvitationRepository();
  const service = createMembershipService({ membershipRepository, invitationRepository });
  return { service, membershipRepository, invitationRepository };
}

describe('MembershipService', () => {
  it('adds a member directly with ACTIVE status', async () => {
    const { service } = createService();

    const member = await service.addMember({
      tenantId: 'tenant-a',
      userId: 'user-1',
      role: 'analyst',
      addedBy: 'admin-1',
    });

    assert.equal(member.tenantId, 'tenant-a');
    assert.equal(member.userId, 'user-1');
    assert.equal(member.role, 'analyst');
    assert.equal(member.status, 'ACTIVE');
    assert.ok(member.joinedAt);
  });

  it('rejects an invalid role on direct add', async () => {
    const { service } = createService();

    await assert.rejects(
      () =>
        service.addMember({
          tenantId: 'tenant-a',
          userId: 'user-1',
          role: 'super_admin' as never,
          addedBy: 'admin-1',
        }),
      (error: unknown) => isAppError(error) && error.code === 'INVALID_ROLE',
    );
  });

  it('rejects adding a member that already exists', async () => {
    const { service } = createService();

    await service.addMember({
      tenantId: 'tenant-a',
      userId: 'user-1',
      role: 'viewer',
      addedBy: 'admin-1',
    });

    await assert.rejects(
      () =>
        service.addMember({
          tenantId: 'tenant-a',
          userId: 'user-1',
          role: 'viewer',
          addedBy: 'admin-1',
        }),
      (error: unknown) => isAppError(error) && error.code === 'MEMBER_ALREADY_EXISTS',
    );
  });

  it('generates a token on invite and creates a PENDING invitation', async () => {
    const { service } = createService();

    const { invitation, token } = await service.inviteMember({
      tenantId: 'tenant-a',
      email: 'new.person@example.com',
      role: 'viewer',
      invitedBy: 'admin-1',
    });

    assert.equal(invitation.status, 'PENDING');
    assert.equal(invitation.email, 'new.person@example.com');
    assert.ok(token.length > 0);
    // The raw token must never be persisted on the record.
    assert.equal((invitation as unknown as { token?: string }).token, undefined);
  });

  it('accepts a valid invitation exactly once and creates an ACTIVE membership', async () => {
    const { service } = createService();

    const { token } = await service.inviteMember({
      tenantId: 'tenant-a',
      email: 'new.person@example.com',
      role: 'analyst',
      invitedBy: 'admin-1',
    });

    const member = await service.acceptInvitation({
      token,
      acceptingUserId: 'user-2',
    });

    assert.equal(member.tenantId, 'tenant-a');
    assert.equal(member.userId, 'user-2');
    assert.equal(member.role, 'analyst');
    assert.equal(member.status, 'ACTIVE');
  });

  it('prevents replay: a second acceptance of the same token is rejected', async () => {
    const { service } = createService();

    const { token } = await service.inviteMember({
      tenantId: 'tenant-a',
      email: 'new.person@example.com',
      role: 'analyst',
      invitedBy: 'admin-1',
    });

    await service.acceptInvitation({ token, acceptingUserId: 'user-2' });

    await assert.rejects(
      () => service.acceptInvitation({ token, acceptingUserId: 'user-2' }),
      (error: unknown) => isAppError(error) && error.code === 'INVITATION_ALREADY_CONSUMED',
    );
  });

  it('rejects acceptance with an unknown/forged token', async () => {
    const { service } = createService();

    await assert.rejects(
      () => service.acceptInvitation({ token: 'not-a-real-token', acceptingUserId: 'user-2' }),
      (error: unknown) => isAppError(error) && error.code === 'INVITATION_NOT_FOUND',
    );
  });

  it('cancels a pending invitation and prevents it from being accepted', async () => {
    const { service } = createService();

    const { invitation, token } = await service.inviteMember({
      tenantId: 'tenant-a',
      email: 'new.person@example.com',
      role: 'viewer',
      invitedBy: 'admin-1',
    });

    const cancelled = await service.cancelInvitation('tenant-a', invitation.invitationId, 'admin-1');
    assert.equal(cancelled.status, 'CANCELLED');

    await assert.rejects(
      () => service.acceptInvitation({ token, acceptingUserId: 'user-2' }),
      (error: unknown) => isAppError(error) && error.code === 'INVITATION_CANCELLED',
    );
  });

  it('supports role reassignment via updateMember (Task 3)', async () => {
    const { service } = createService();

    const member = await service.addMember({
      tenantId: 'tenant-a',
      userId: 'user-1',
      role: 'viewer',
      addedBy: 'admin-1',
    });

    const updated = await service.updateMember({
      memberId: member.memberId,
      role: 'security_admin',
      actorUserId: 'admin-1',
    });

    assert.equal(updated.role, 'security_admin');
    assert.equal(updated.version, member.version + 1);
  });

  it('supports suspend and reactivate lifecycle transitions (Task 4)', async () => {
    const { service } = createService();

    const member = await service.addMember({
      tenantId: 'tenant-a',
      userId: 'user-1',
      role: 'viewer',
      addedBy: 'admin-1',
    });

    const suspended = await service.updateMember({
      memberId: member.memberId,
      status: 'SUSPENDED',
      actorUserId: 'admin-1',
    });
    assert.equal(suspended.status, 'SUSPENDED');

    const reactivated = await service.updateMember({
      memberId: member.memberId,
      status: 'ACTIVE',
      actorUserId: 'admin-1',
    });
    assert.equal(reactivated.status, 'ACTIVE');
  });

  it('supports remove (soft-delete) lifecycle and blocks further updates (Task 4)', async () => {
    const { service } = createService();

    const member = await service.addMember({
      tenantId: 'tenant-a',
      userId: 'user-1',
      role: 'viewer',
      addedBy: 'admin-1',
    });

    const removed = await service.removeMember(member.memberId, 'admin-1');
    assert.equal(removed.status, 'REMOVED');

    await assert.rejects(
      () => service.updateMember({ memberId: member.memberId, role: 'analyst' }),
      (error: unknown) => isAppError(error) && error.code === 'MEMBER_REMOVED',
    );
  });

  it('rejects an invalid status transition', async () => {
    const { service } = createService();

    const member = await service.addMember({
      tenantId: 'tenant-a',
      userId: 'user-1',
      role: 'viewer',
      addedBy: 'admin-1',
    });

    await service.removeMember(member.memberId, 'admin-1');

    await assert.rejects(
      () => service.updateMember({ memberId: member.memberId, status: 'ACTIVE' }),
      (error: unknown) => isAppError(error) && error.code === 'MEMBER_REMOVED',
    );
  });

  it('detects a version conflict on concurrent update', async () => {
    const { service } = createService();

    const member = await service.addMember({
      tenantId: 'tenant-a',
      userId: 'user-1',
      role: 'viewer',
      addedBy: 'admin-1',
    });

    await assert.rejects(
      () =>
        service.updateMember({
          memberId: member.memberId,
          role: 'analyst',
          expectedVersion: member.version + 5,
        }),
      (error: unknown) => isAppError(error) && error.code === 'MEMBER_VERSION_CONFLICT',
    );
  });
});
