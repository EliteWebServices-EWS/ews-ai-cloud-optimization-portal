import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryInvitationRepository,
  InMemoryMembershipRepository,
} from '../../membership/membership.store';
import { createMembershipService } from '../../membership/membership.service';
import {
  generateInvitationId,
  generateInvitationToken,
  hashInvitationToken,
} from '../../membership/membership.token';
import { isAppError } from '../../shared/utils';

const TENANT_ID = 'tenant-int-expiry-001';

/**
 * Sprint 12 / Engineer 4 — Task 1 ("Invitation lifecycle") and Task 4
 * ("Invitation expiration") coverage.
 *
 * Confirmed gap: as of this branch, no test anywhere exercises invitation
 * expiration, even though the enforcement is real and already implemented
 * in membership.service.ts:
 *   - resolveInvitationStatus() lazily reports EXPIRED once expiresAtIso
 *     has passed, without requiring a write.
 *   - acceptInvitation() throws INVITATION_EXPIRED (409) if a token is
 *     redeemed after expiry, and does not create a membership record.
 *
 * Rather than waiting out the real 7-day default TTL or mocking the system
 * clock, these tests seed an invitation directly via the repository with a
 * controlled expiresAtIso, using the same token utilities the service uses
 * internally -- this keeps the tests fast and deterministic while still
 * exercising the real acceptance path (hash lookup + service-level checks).
 */

function buildExpiredInvitation(overrides: Partial<Parameters<InMemoryInvitationRepository['create']>[0]> = {}) {
  const token = generateInvitationToken();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  return {
    token,
    input: {
      tenantId: TENANT_ID,
      invitationId: generateInvitationId(),
      email: 'latecomer@example.com',
      role: 'viewer' as const,
      status: 'PENDING' as const,
      tokenHash: hashInvitationToken(token),
      expiresAtIso: oneHourAgo,
      expiresAt: Math.floor(Date.now() / 1000) - 3600,
      invitedBy: 'owner-user-1',
      ...overrides,
    },
  };
}

describe('Invitation expiration', () => {
  it('resolveInvitationStatus lazily reports EXPIRED once expiresAtIso has passed, without a write', async () => {
    const invitationRepository = new InMemoryInvitationRepository();
    const membershipRepository = new InMemoryMembershipRepository();
    const service = createMembershipService({ membershipRepository, invitationRepository });

    const { input } = buildExpiredInvitation();
    const stored = await invitationRepository.create(input);

    // The persisted status field is still PENDING -- expiry is computed
    // lazily, not swept by a background job in this implementation.
    assert.equal(stored.status, 'PENDING');

    // But resolveInvitationStatus must report the effective status as EXPIRED.
    assert.equal(service.resolveInvitationStatus(stored), 'EXPIRED');
  });

  it('a freshly created invitation (not yet expired) resolves as PENDING', async () => {
    const invitationRepository = new InMemoryInvitationRepository();
    const membershipRepository = new InMemoryMembershipRepository();
    const service = createMembershipService({ membershipRepository, invitationRepository });

    const { invitation } = await service.inviteMember({
      tenantId: TENANT_ID,
      email: 'ontime@example.com',
      role: 'viewer',
      invitedBy: 'owner-user-1',
    });

    assert.equal(service.resolveInvitationStatus(invitation), 'PENDING');
  });

  it('rejects acceptance of an expired token with INVITATION_EXPIRED and creates no membership', async () => {
    const invitationRepository = new InMemoryInvitationRepository();
    const membershipRepository = new InMemoryMembershipRepository();
    const service = createMembershipService({ membershipRepository, invitationRepository });

    const { token, input } = buildExpiredInvitation();
    await invitationRepository.create(input);

    await assert.rejects(
      () => service.acceptInvitation({ token, acceptingUserId: 'latecomer-user-1' }),
      (error: unknown) => isAppError(error) && error.code === 'INVITATION_EXPIRED' && error.statusCode === 409,
    );

    // No membership should have been created as a side effect of the failed attempt.
    const membership = await membershipRepository.get(TENANT_ID, 'latecomer-user-1');
    assert.equal(membership, undefined);
  });

  it('rejects an unknown/forged token distinctly from an expired one (INVITATION_NOT_FOUND, not INVITATION_EXPIRED)', async () => {
    const invitationRepository = new InMemoryInvitationRepository();
    const membershipRepository = new InMemoryMembershipRepository();
    const service = createMembershipService({ membershipRepository, invitationRepository });

    await assert.rejects(
      () =>
        service.acceptInvitation({
          token: 'this-token-was-never-issued',
          acceptingUserId: 'nobody',
        }),
      (error: unknown) => isAppError(error) && error.code === 'INVITATION_NOT_FOUND' && error.statusCode === 404,
    );
  });

  it('an expired invitation cannot be accepted even if the caller retries with the correct email/role context', async () => {
    // Guards against a naive re-implementation that only checks status !== 'PENDING'
    // and forgets the expiresAtIso comparison for invitations still nominally PENDING.
    const invitationRepository = new InMemoryInvitationRepository();
    const membershipRepository = new InMemoryMembershipRepository();
    const service = createMembershipService({ membershipRepository, invitationRepository });

    const { token, input } = buildExpiredInvitation({ role: 'tenant_admin' });
    const stored = await invitationRepository.create(input);
    assert.equal(stored.status, 'PENDING', 'sanity check: repository does not eagerly flip status to EXPIRED');

    let attempts = 0;
    for (let i = 0; i < 3; i += 1) {
      attempts += 1;
      await assert.rejects(
        () => service.acceptInvitation({ token, acceptingUserId: 'persistent-user' }),
        (error: unknown) => isAppError(error) && error.code === 'INVITATION_EXPIRED',
      );
    }
    assert.equal(attempts, 3);

    const membership = await membershipRepository.get(TENANT_ID, 'persistent-user');
    assert.equal(membership, undefined);
  });
});