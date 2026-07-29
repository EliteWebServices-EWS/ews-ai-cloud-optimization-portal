import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MockTenantRepository } from '../../repositories/mock/mock-tenant-repository';
import {
  InMemoryInvitationRepository,
  InMemoryMembershipRepository,
} from '../../membership/membership.store';
import { createMembershipService } from '../../membership/membership.service';
import { isAppError } from '../../shared/utils';

/**
 * Sprint 12 / Engineer 4 — Task 1 integration coverage.
 *
 * Unlike the existing unit suites (tests/unit/tenant*.test.ts,
 * tests/unit/membership/membership-service.test.ts), which each exercise a
 * single repository or service in isolation, this file drives a full,
 * connected lifecycle across the Tenant Registry (Engineer 1) and Membership
 * (Engineer 2) subsystems together — the way a real admin workflow actually
 * happens. It intentionally does not re-test individual validation rules
 * already covered at the unit level.
 */

function buildTenantInput(overrides: Partial<Parameters<MockTenantRepository['create']>[0]> = {}) {
  return {
    tenantId: 'tenant-int-001',
    organizationName: 'Integration Test Org',
    displayName: 'Integration Test Org',
    slug: 'integration-test-org',
    ownerUserId: 'owner-user-1',
    primaryContact: { name: 'Owner One', email: 'owner@example.com' },
    status: 'ACTIVE' as const,
    region: 'us-east-1',
    subscriptionPlan: 'enterprise',
    ...overrides,
  };
}

describe('Tenant + Membership integration lifecycle', () => {
  it('walks a tenant and its member through the full lifecycle: create tenant, invite, accept, reassign role, suspend, reactivate, remove', async () => {
    const tenantRepository = new MockTenantRepository();
    const membershipRepository = new InMemoryMembershipRepository();
    const invitationRepository = new InMemoryInvitationRepository();
    const membershipService = createMembershipService({
      membershipRepository,
      invitationRepository,
    });

    // 1. Tenant Registry: create the tenant (Engineer 1's subsystem)
    const tenant = await tenantRepository.create(buildTenantInput());
    assert.equal(tenant.status, 'ACTIVE');
    assert.equal(tenant.version, 1);

    // 2. Membership: invite a member into that tenant (Engineer 2's subsystem)
    const { invitation, token } = await membershipService.inviteMember({
      tenantId: tenant.tenantId,
      email: 'new-member@example.com',
      role: 'analyst',
      invitedBy: tenant.ownerUserId,
    });
    assert.equal(invitation.status, 'PENDING');
    assert.equal(invitation.tenantId, tenant.tenantId);
    assert.ok(token, 'a raw bearer token must be returned exactly once on invite');

    // 3. Accept the invitation -> creates an ACTIVE membership
    const membership = await membershipService.acceptInvitation({
      token,
      acceptingUserId: 'new-member-user-1',
    });
    assert.equal(membership.tenantId, tenant.tenantId);
    assert.equal(membership.status, 'ACTIVE');
    assert.equal(membership.role, 'analyst');

    // 4. Role assignment (Task 3): promote analyst -> tenant_admin
    const promoted = await membershipService.updateMember({
      memberId: membership.memberId,
      role: 'tenant_admin',
      actorUserId: tenant.ownerUserId,
      expectedVersion: membership.version,
    });
    assert.equal(promoted.role, 'tenant_admin');
    assert.equal(promoted.version, membership.version + 1);

    // 5. Suspension (Task 4): suspend the member
    const suspended = await membershipService.updateMember({
      memberId: promoted.memberId,
      status: 'SUSPENDED',
      actorUserId: tenant.ownerUserId,
      expectedVersion: promoted.version,
    });
    assert.equal(suspended.status, 'SUSPENDED');

    // 6. Reactivation (Task 4): bring the member back
    const reactivated = await membershipService.updateMember({
      memberId: suspended.memberId,
      status: 'ACTIVE',
      actorUserId: tenant.ownerUserId,
      expectedVersion: suspended.version,
    });
    assert.equal(reactivated.status, 'ACTIVE');

    // 7. Now suspend the TENANT itself (Engineer 1's lifecycle, not the member's)
    const suspendedTenant = await tenantRepository.transitionStatus(
      tenant.tenantId,
      'SUSPENDED',
      { expectedVersion: tenant.version },
    );
    assert.equal(suspendedTenant.status, 'SUSPENDED');

    // A suspended tenant's membership records are untouched by the tenant-level
    // transition alone -- membership status is managed independently. Confirm
    // that assumption explicitly, since it's an easy place for the two
    // subsystems to silently disagree.
    const memberAfterTenantSuspension = await membershipRepository.get(
      tenant.tenantId,
      'new-member-user-1',
    );
    assert.equal(
      memberAfterTenantSuspension?.status,
      'ACTIVE',
      'membership status must not be implicitly changed by a tenant-level status transition',
    );

    // 8. Reactivate the tenant
    const reactivatedTenant = await tenantRepository.transitionStatus(
      tenant.tenantId,
      'ACTIVE',
      { expectedVersion: suspendedTenant.version },
    );
    assert.equal(reactivatedTenant.status, 'ACTIVE');

    // 9. Remove (soft-delete) the member entirely
    const removed = await membershipService.removeMember(
      reactivated.memberId,
      tenant.ownerUserId,
      reactivated.version,
    );
    assert.equal(removed.status, 'REMOVED');

    // Further updates to a removed member must be rejected
    await assert.rejects(
      () =>
        membershipService.updateMember({
          memberId: removed.memberId,
          role: 'viewer',
          expectedVersion: removed.version,
        }),
      (error: unknown) => isAppError(error),
    );
  });

  it('rejects an invalid tenant lifecycle transition (e.g. DELETED -> ACTIVE)', async () => {
    const tenantRepository = new MockTenantRepository();
    const tenant = await tenantRepository.create(
      buildTenantInput({ tenantId: 'tenant-int-002', slug: 'integration-test-org-2' }),
    );

    const archived = await tenantRepository.transitionStatus(tenant.tenantId, 'ARCHIVED', {
      expectedVersion: tenant.version,
    });
    const deleted = await tenantRepository.transitionStatus(tenant.tenantId, 'DELETED', {
      expectedVersion: archived.version,
    });
    assert.equal(deleted.status, 'DELETED');

    await assert.rejects(() =>
      tenantRepository.transitionStatus(tenant.tenantId, 'ACTIVE', {
        expectedVersion: deleted.version,
      }),
    );
  });
});