import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAdministerTenant,
  isPlatformAdministrator,
  isTenantAdministrator,
  isTenantOwner,
} from '../../auth';
import type { RequestSecurityContext } from '../../auth';
import type { TenantRecord } from '../../repositories/models';

function buildContext(
  overrides: Partial<RequestSecurityContext> = {}
): RequestSecurityContext {
  return {
    requestId: 'req-1',
    correlationId: 'corr-1',
    userId: 'user-viewer',
    email: 'viewer@example.com',
    roles: ['viewer'],
    tenantId: 'tenant-a',
    claimPresent: true,
    usedFallback: false,
    invalidClaim: false,
    ...overrides,
  };
}

function buildTenant(overrides: Partial<TenantRecord> = {}): TenantRecord {
  return {
    tenantId: 'tenant-a',
    organizationName: 'Acme Corp',
    displayName: 'Acme',
    slug: 'acme',
    ownerUserId: 'user-owner',
    primaryContact: { name: 'Ada Lovelace', email: 'ada@acme.example' },
    status: 'ACTIVE',
    region: 'us-east-1',
    subscriptionPlan: 'enterprise',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('isPlatformAdministrator', () => {
  it('is true for a user holding the admin role', () => {
    assert.equal(
      isPlatformAdministrator(buildContext({ roles: ['admin'] })),
      true
    );
  });

  it('is false for viewer/analyst-only users', () => {
    assert.equal(
      isPlatformAdministrator(buildContext({ roles: ['viewer'] })),
      false
    );
    assert.equal(
      isPlatformAdministrator(buildContext({ roles: ['analyst'] })),
      false
    );
  });
});

describe('isTenantOwner', () => {
  it('is true when the caller userId matches tenant.ownerUserId', () => {
    const tenant = buildTenant({ ownerUserId: 'user-owner' });
    assert.equal(
      isTenantOwner(buildContext({ userId: 'user-owner' }), tenant),
      true
    );
  });

  it('is false for a different userId', () => {
    const tenant = buildTenant({ ownerUserId: 'user-owner' });
    assert.equal(
      isTenantOwner(buildContext({ userId: 'someone-else' }), tenant),
      false
    );
  });

  it('is false when the caller has no userId', () => {
    const tenant = buildTenant({ ownerUserId: 'user-owner' });
    assert.equal(isTenantOwner(buildContext({ userId: null }), tenant), false);
  });
});

describe('isTenantAdministrator', () => {
  it('is true for an admin-role user whose tenant_id matches the target tenant', () => {
    const tenant = buildTenant({ tenantId: 'tenant-a' });
    const context = buildContext({ roles: ['admin'], tenantId: 'tenant-a' });
    assert.equal(isTenantAdministrator(context, tenant), true);
  });

  it('is false for an admin-role user whose tenant_id does not match', () => {
    const tenant = buildTenant({ tenantId: 'tenant-a' });
    const context = buildContext({ roles: ['admin'], tenantId: 'tenant-b' });
    assert.equal(isTenantAdministrator(context, tenant), false);
  });

  it('is false for a non-admin user even if tenant_id matches', () => {
    const tenant = buildTenant({ tenantId: 'tenant-a' });
    const context = buildContext({ roles: ['analyst'], tenantId: 'tenant-a' });
    assert.equal(isTenantAdministrator(context, tenant), false);
  });
});

describe('canAdministerTenant', () => {
  const tenant = buildTenant({
    tenantId: 'tenant-a',
    ownerUserId: 'user-owner',
  });

  it('allows a Platform Admin regardless of tenant_id or ownership', () => {
    const context = buildContext({
      roles: ['admin'],
      tenantId: 'tenant-other',
      userId: 'someone-else',
    });
    assert.equal(canAdministerTenant(context, tenant), true);
  });

  it('allows the Tenant Owner even without the admin role', () => {
    const context = buildContext({
      roles: ['viewer'],
      tenantId: 'tenant-a',
      userId: 'user-owner',
    });
    assert.equal(canAdministerTenant(context, tenant), true);
  });

  it('allows a Tenant Admin (admin role + matching tenant_id)', () => {
    const context = buildContext({
      roles: ['admin'],
      tenantId: 'tenant-a',
      userId: 'someone-else',
    });
    assert.equal(canAdministerTenant(context, tenant), true);
  });

  it('denies an unrelated viewer from another tenant', () => {
    const context = buildContext({
      roles: ['viewer'],
      tenantId: 'tenant-b',
      userId: 'someone-else',
    });
    assert.equal(canAdministerTenant(context, tenant), false);
  });

  it('denies an analyst from another tenant who is not the owner', () => {
    const context = buildContext({
      roles: ['analyst'],
      tenantId: 'tenant-b',
      userId: 'someone-else',
    });
    assert.equal(canAdministerTenant(context, tenant), false);
  });
});
