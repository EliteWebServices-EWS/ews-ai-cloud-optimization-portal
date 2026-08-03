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
  return { service, membershipRepository };
}

describe('MembershipService.bootstrapFirstOwner', () => {
  it('creates ACTIVE tenant_owner with version 1 and generated memberId', async () => {
    const { service } = createService();

    const member = await service.bootstrapFirstOwner({
      tenantId: 'sisum-default',
      userId: 'platform-admin-sub',
    });

    assert.equal(member.tenantId, 'sisum-default');
    assert.equal(member.userId, 'platform-admin-sub');
    assert.equal(member.role, 'tenant_owner');
    assert.equal(member.status, 'ACTIVE');
    assert.equal(member.version, 1);
    assert.ok(member.memberId.startsWith('mem-'));
    assert.ok(member.joinedAt);
    assert.ok(member.createdAt);
  });

  it('returns TENANT_OWNER_ALREADY_BOOTSTRAPPED when legacy membership exists without marker', async () => {
    const { service, membershipRepository } = createService();

    await membershipRepository.create({
      tenantId: 'sisum-default',
      memberId: 'mem-legacy',
      userId: 'legacy-user',
      role: 'viewer',
      status: 'PENDING',
      joinedAt: new Date().toISOString(),
      statusChangedAt: new Date().toISOString(),
      statusChangedBy: 'legacy',
      invitedBy: 'legacy',
    });

    await assert.rejects(
      () =>
        service.bootstrapFirstOwner({
          tenantId: 'sisum-default',
          userId: 'platform-admin-sub',
        }),
      (error: unknown) =>
        isAppError(error) && error.code === 'TENANT_OWNER_ALREADY_BOOTSTRAPPED',
    );
  });

  it('returns TENANT_OWNER_ALREADY_BOOTSTRAPPED on second attempt', async () => {
    const { service } = createService();

    await service.bootstrapFirstOwner({
      tenantId: 'sisum-default',
      userId: 'platform-admin-sub',
    });

    await assert.rejects(
      () =>
        service.bootstrapFirstOwner({
          tenantId: 'sisum-default',
          userId: 'platform-admin-sub',
        }),
      (error: unknown) =>
        isAppError(error) && error.code === 'TENANT_OWNER_ALREADY_BOOTSTRAPPED',
    );
  });
});
