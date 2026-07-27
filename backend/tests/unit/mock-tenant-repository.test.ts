import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  RepositoryNotFoundError,
} from '../../database';
import { InvalidTenantTransitionError } from '../../services/tenant-lifecycle';
import { MockTenantRepository } from '../../repositories/mock';
import type { CreateTenantInput } from '../../repositories/contracts';

function buildCreateInput(
  overrides: Partial<CreateTenantInput> = {}
): CreateTenantInput {
  return {
    tenantId: 'tenant-001',
    organizationName: 'Acme Corp',
    displayName: 'Acme',
    slug: 'acme',
    ownerUserId: 'user-001',
    primaryContact: { name: 'Ada Lovelace', email: 'ada@acme.example' },
    status: 'PROVISIONING',
    region: 'us-east-1',
    subscriptionPlan: 'enterprise',
    ...overrides,
  };
}

describe('MockTenantRepository', () => {
  let repository: MockTenantRepository;

  beforeEach(() => {
    repository = new MockTenantRepository();
  });

  it('creates a tenant with version 1 and timestamps', async () => {
    const tenant = await repository.create(buildCreateInput());
    assert.equal(tenant.version, 1);
    assert.ok(tenant.createdAt);
    assert.equal(tenant.createdAt, tenant.updatedAt);
  });

  it('normalizes the slug to lowercase', async () => {
    const tenant = await repository.create(
      buildCreateInput({ slug: 'ACME' })
    );
    assert.equal(tenant.slug, 'acme');
  });

  it('rejects a duplicate tenantId', async () => {
    await repository.create(buildCreateInput());
    await assert.rejects(
      () => repository.create(buildCreateInput({ slug: 'other-slug' })),
      RepositoryAlreadyExistsError
    );
  });

  it('rejects a duplicate slug under a different tenantId', async () => {
    await repository.create(buildCreateInput());
    await assert.rejects(
      () =>
        repository.create(
          buildCreateInput({ tenantId: 'tenant-002' })
        ),
      RepositoryAlreadyExistsError
    );
  });

  it('finds a tenant by ID and by slug', async () => {
    await repository.create(buildCreateInput());
    assert.equal((await repository.getById('tenant-001'))?.slug, 'acme');
    assert.equal(
      (await repository.getBySlug('ACME'))?.tenantId,
      'tenant-001'
    );
  });

  it('returns undefined for a missing tenant', async () => {
    assert.equal(await repository.getById('ghost'), undefined);
    assert.equal(await repository.getBySlug('ghost'), undefined);
  });

  it('updates a tenant and bumps its version', async () => {
    const created = await repository.create(buildCreateInput());
    const updated = await repository.update(
      'tenant-001',
      { organizationName: 'Acme International' },
      { expectedVersion: created.version }
    );
    assert.equal(updated.organizationName, 'Acme International');
    assert.equal(updated.version, 2);
  });

  it('rejects update with a stale expectedVersion', async () => {
    await repository.create(buildCreateInput());
    await assert.rejects(
      () =>
        repository.update(
          'tenant-001',
          { organizationName: 'Acme International' },
          { expectedVersion: 99 }
        ),
      RepositoryConflictError
    );
  });

  it('rejects update of a nonexistent tenant', async () => {
    await assert.rejects(
      () =>
        repository.update(
          'ghost',
          { organizationName: 'X' },
          { expectedVersion: 1 }
        ),
      RepositoryNotFoundError
    );
  });

  it('transitions status along an allowed path', async () => {
    const created = await repository.create(buildCreateInput());
    const active = await repository.transitionStatus('tenant-001', 'ACTIVE', {
      expectedVersion: created.version,
    });
    assert.equal(active.status, 'ACTIVE');

    const suspended = await repository.transitionStatus(
      'tenant-001',
      'SUSPENDED',
      { expectedVersion: active.version }
    );
    assert.equal(suspended.status, 'SUSPENDED');
  });

  it('rejects a disallowed status transition', async () => {
    const created = await repository.create(buildCreateInput());
    await repository.transitionStatus('tenant-001', 'ACTIVE', {
      expectedVersion: created.version,
    });

    await assert.rejects(
      () =>
        repository.transitionStatus('tenant-001', 'DELETED', {
          expectedVersion: 2,
        }),
      InvalidTenantTransitionError
    );
  });

  it('rejects status transition with a stale expectedVersion', async () => {
    const created = await repository.create(buildCreateInput());
    await assert.rejects(
      () =>
        repository.transitionStatus('tenant-001', 'ACTIVE', {
          expectedVersion: created.version + 5,
        }),
      RepositoryConflictError
    );
  });

  it('lists tenants by owner, paginated', async () => {
    await repository.create(buildCreateInput({ tenantId: 't-1', slug: 's-1', ownerUserId: 'owner-a' }));
    await repository.create(buildCreateInput({ tenantId: 't-2', slug: 's-2', ownerUserId: 'owner-a' }));
    await repository.create(buildCreateInput({ tenantId: 't-3', slug: 's-3', ownerUserId: 'owner-b' }));

    const page = await repository.listByOwner('owner-a');
    assert.equal(page.items.length, 2);
    assert.ok(page.items.every((t) => t.ownerUserId === 'owner-a'));
  });

  it('lists tenants by status, paginated', async () => {
    const a = await repository.create(buildCreateInput({ tenantId: 't-1', slug: 's-1' }));
    await repository.create(buildCreateInput({ tenantId: 't-2', slug: 's-2' }));
    await repository.transitionStatus('t-1', 'ACTIVE', { expectedVersion: a.version });

    const active = await repository.listByStatus('ACTIVE');
    assert.deepEqual(active.items.map((t) => t.tenantId), ['t-1']);

    const provisioning = await repository.listByStatus('PROVISIONING');
    assert.deepEqual(provisioning.items.map((t) => t.tenantId), ['t-2']);
  });

  it('lists every tenant platform-wide via listAll', async () => {
    await repository.create(buildCreateInput({ tenantId: 't-1', slug: 's-1', ownerUserId: 'owner-a' }));
    await repository.create(buildCreateInput({ tenantId: 't-2', slug: 's-2', ownerUserId: 'owner-b' }));

    const all = await repository.listAll();
    assert.equal(all.items.length, 2);
  });

  it('paginates listAll with a continuation token', async () => {
    for (let i = 0; i < 5; i += 1) {
      await repository.create(
        buildCreateInput({ tenantId: `t-${i}`, slug: `s-${i}` })
      );
    }

    const first = await repository.listAll({ limit: 2 });
    assert.equal(first.items.length, 2);
    assert.ok(first.nextToken);

    const second = await repository.listAll({
      limit: 2,
      nextToken: first.nextToken,
    });
    assert.equal(second.items.length, 2);

    const ids = new Set([
      ...first.items.map((t) => t.tenantId),
      ...second.items.map((t) => t.tenantId),
    ]);
    assert.equal(ids.size, 4);
  });
});
