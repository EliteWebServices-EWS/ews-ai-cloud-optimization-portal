import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTenantQuery,
  fetchAllTenants,
  filterTenants,
  parseTenantQuery,
  paginateTenants,
  searchTenants,
  sortTenants,
  TenantQueryValidationError,
  type TenantQuery,
} from '../../services/tenant-query';
import type { TenantRecord } from '../../repositories/models';

function buildTenant(overrides: Partial<TenantRecord> = {}): TenantRecord {
  return {
    tenantId: 'tenant-001',
    organizationName: 'Acme Corp',
    displayName: 'Acme',
    slug: 'acme',
    ownerUserId: 'user-001',
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

const TENANTS: TenantRecord[] = [
  buildTenant({
    tenantId: 'tenant-a',
    organizationName: 'Acme Corp',
    displayName: 'Acme',
    slug: 'acme',
    status: 'ACTIVE',
    region: 'us-east-1',
    subscriptionPlan: 'enterprise',
    createdAt: '2026-01-01T00:00:00.000Z',
  }),
  buildTenant({
    tenantId: 'tenant-b',
    organizationName: 'Beta LLC',
    displayName: 'Beta',
    slug: 'beta',
    status: 'SUSPENDED',
    region: 'us-west-2',
    subscriptionPlan: 'starter',
    createdAt: '2026-02-01T00:00:00.000Z',
    primaryContact: { name: 'Bob Beta', email: 'bob@beta.example' },
  }),
  buildTenant({
    tenantId: 'tenant-c',
    organizationName: 'Cadence Inc',
    displayName: 'Cadence',
    slug: 'cadence',
    status: 'ACTIVE',
    region: 'us-east-1',
    subscriptionPlan: 'starter',
    createdAt: '2026-03-01T00:00:00.000Z',
    primaryContact: { name: 'Cara Cadence', email: 'cara@cadence.example' },
  }),
];

describe('parseTenantQuery', () => {
  it('defaults sortBy/sortOrder/limit and omits optional fields', () => {
    const query = parseTenantQuery({});
    assert.equal(query.sortBy, 'createdAt');
    assert.equal(query.sortOrder, 'desc');
    assert.equal(query.limit, 50);
    assert.equal(query.search, undefined);
    assert.equal(query.filters.status, undefined);
  });

  it('parses status, region, subscriptionPlan, search, sort, and limit', () => {
    const query = parseTenantQuery({
      status: 'ACTIVE',
      region: 'us-east-1',
      subscriptionPlan: 'enterprise',
      search: 'acme',
      sortBy: 'organizationName',
      sortOrder: 'asc',
      limit: '10',
    });

    assert.deepEqual(query.filters, {
      status: 'ACTIVE',
      region: 'us-east-1',
      subscriptionPlan: 'enterprise',
    });
    assert.equal(query.search, 'acme');
    assert.equal(query.sortBy, 'organizationName');
    assert.equal(query.sortOrder, 'asc');
    assert.equal(query.limit, 10);
  });

  it('rejects an invalid status', () => {
    assert.throws(
      () => parseTenantQuery({ status: 'BOGUS' }),
      TenantQueryValidationError
    );
  });

  it('rejects an invalid sortBy', () => {
    assert.throws(
      () => parseTenantQuery({ sortBy: 'bogus' }),
      TenantQueryValidationError
    );
  });

  it('rejects an invalid sortOrder', () => {
    assert.throws(
      () => parseTenantQuery({ sortOrder: 'sideways' }),
      TenantQueryValidationError
    );
  });

  it('rejects an out-of-range limit', () => {
    assert.throws(
      () => parseTenantQuery({ limit: '999' }),
      TenantQueryValidationError
    );
    assert.throws(
      () => parseTenantQuery({ limit: '0' }),
      TenantQueryValidationError
    );
  });
});

describe('filterTenants', () => {
  it('filters by status', () => {
    const result = filterTenants(TENANTS, { status: 'ACTIVE' });
    assert.deepEqual(
      result.map((t) => t.tenantId).sort(),
      ['tenant-a', 'tenant-c']
    );
  });

  it('filters by region and subscriptionPlan together', () => {
    const result = filterTenants(TENANTS, {
      region: 'us-east-1',
      subscriptionPlan: 'starter',
    });
    assert.deepEqual(
      result.map((t) => t.tenantId),
      ['tenant-c']
    );
  });

  it('returns everything when no filters are set', () => {
    assert.equal(filterTenants(TENANTS, {}).length, 3);
  });
});

describe('searchTenants', () => {
  it('matches organizationName case-insensitively', () => {
    const result = searchTenants(TENANTS, 'CADENCE');
    assert.deepEqual(
      result.map((t) => t.tenantId),
      ['tenant-c']
    );
  });

  it('matches primaryContact.email', () => {
    const result = searchTenants(TENANTS, 'bob@beta');
    assert.deepEqual(
      result.map((t) => t.tenantId),
      ['tenant-b']
    );
  });

  it('matches slug', () => {
    const result = searchTenants(TENANTS, 'acme');
    assert.deepEqual(
      result.map((t) => t.tenantId),
      ['tenant-a']
    );
  });

  it('returns no matches for an unrelated term', () => {
    assert.deepEqual(searchTenants(TENANTS, 'nonexistent'), []);
  });
});

describe('sortTenants', () => {
  it('sorts by createdAt descending by default direction', () => {
    const result = sortTenants(TENANTS, 'createdAt', 'desc');
    assert.deepEqual(
      result.map((t) => t.tenantId),
      ['tenant-c', 'tenant-b', 'tenant-a']
    );
  });

  it('sorts by organizationName ascending', () => {
    const result = sortTenants(TENANTS, 'organizationName', 'asc');
    assert.deepEqual(
      result.map((t) => t.tenantId),
      ['tenant-a', 'tenant-b', 'tenant-c']
    );
  });

  it('sorts by status', () => {
    const result = sortTenants(TENANTS, 'status', 'asc');
    // ACTIVE < ARCHIVED < ... < SUSPENDED lexicographically; only ACTIVE/SUSPENDED present here.
    assert.equal(result[0].status, 'ACTIVE');
    assert.equal(result[result.length - 1].status, 'SUSPENDED');
  });
});

describe('paginateTenants', () => {
  it('slices the first page and returns a continuation token', () => {
    const page = paginateTenants(TENANTS, 2);
    assert.equal(page.tenants.length, 2);
    assert.equal(page.total, 3);
    assert.ok(page.nextToken);
  });

  it('follows the continuation token to the final page', () => {
    const first = paginateTenants(TENANTS, 2);
    const second = paginateTenants(TENANTS, 2, first.nextToken);
    assert.equal(second.tenants.length, 1);
    assert.equal(second.nextToken, undefined);
  });

  it('ignores a malformed token and returns the first page', () => {
    const page = paginateTenants(TENANTS, 2, 'not-a-valid-token');
    assert.equal(page.tenants.length, 2);
  });
});

describe('applyTenantQuery', () => {
  it('composes search, filter, sort, and pagination', () => {
    const query: TenantQuery = {
      filters: { region: 'us-east-1' },
      search: undefined,
      sortBy: 'createdAt',
      sortOrder: 'asc',
      limit: 10,
    };

    const result = applyTenantQuery(TENANTS, query);
    assert.deepEqual(
      result.tenants.map((t) => t.tenantId),
      ['tenant-a', 'tenant-c']
    );
    assert.equal(result.total, 2);
  });
});

describe('fetchAllTenants', () => {
  it('follows nextToken until the registry is exhausted', async () => {
    const pages = [
      { items: [TENANTS[0]], nextToken: 'page-2' },
      { items: [TENANTS[1]], nextToken: 'page-3' },
      { items: [TENANTS[2]], nextToken: undefined },
    ];

    let callIndex = 0;
    const all = await fetchAllTenants(async () => pages[callIndex++]);

    assert.equal(callIndex, 3);
    assert.deepEqual(
      all.map((t) => t.tenantId),
      ['tenant-a', 'tenant-b', 'tenant-c']
    );
  });
});
