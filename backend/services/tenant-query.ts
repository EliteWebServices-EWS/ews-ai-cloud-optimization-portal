/**
 * Tenant administration querying — search, filtering, sorting, and
 * pagination across the platform-wide tenant registry (Platform Admin only).
 *
 * Mirrors engines/reporting/report.query.ts: TenantRepository.listAll()
 * supplies one DynamoDB-paginated axis (gsi4, sorted by createdAt), and
 * these pure functions apply search/filter/sort/pagination in memory on
 * top of it, so a mock and a DynamoDB-backed repository behave identically.
 * Registry sizes at this platform's scale are small enough to query and
 * paginate fully — the same tradeoff already documented for reports.
 */

import type { TenantRecord, TenantStatus } from '../repositories/models';

export const TENANT_SORT_FIELDS = [
  'createdAt',
  'organizationName',
  'status',
] as const;

export type TenantSortField = (typeof TENANT_SORT_FIELDS)[number];

export type TenantSortOrder = 'asc' | 'desc';

export const DEFAULT_TENANT_QUERY_LIMIT = 50;
export const MAX_TENANT_QUERY_LIMIT = 100;

export const TENANT_STATUS_VALUES: readonly TenantStatus[] = [
  'PROVISIONING',
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED',
  'DELETED',
];

export interface TenantFilterCriteria {
  status?: TenantStatus;
  region?: string;
  subscriptionPlan?: string;
}

export interface TenantQuery {
  filters: TenantFilterCriteria;
  search?: string;
  sortBy: TenantSortField;
  sortOrder: TenantSortOrder;
  limit: number;
  nextToken?: string;
}

export interface TenantQueryResult {
  tenants: TenantRecord[];
  total: number;
  nextToken?: string;
}

export class TenantQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantQueryValidationError';
  }
}

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/** Parse and validate query-string parameters into a tenant query. */
export function parseTenantQuery(
  query: Record<string, unknown>
): TenantQuery {
  const filters: TenantFilterCriteria = {};

  const status = readTrimmedString(query.status);
  if (status !== undefined) {
    if (!TENANT_STATUS_VALUES.includes(status as TenantStatus)) {
      throw new TenantQueryValidationError(
        `status must be one of: ${TENANT_STATUS_VALUES.join(', ')}`
      );
    }
    filters.status = status as TenantStatus;
  }

  filters.region = readTrimmedString(query.region);
  filters.subscriptionPlan = readTrimmedString(query.subscriptionPlan);

  const search = readTrimmedString(query.search);

  let sortBy: TenantSortField = 'createdAt';
  const rawSortBy = readTrimmedString(query.sortBy);
  if (rawSortBy !== undefined) {
    if (!TENANT_SORT_FIELDS.includes(rawSortBy as TenantSortField)) {
      throw new TenantQueryValidationError(
        `sortBy must be one of: ${TENANT_SORT_FIELDS.join(', ')}`
      );
    }
    sortBy = rawSortBy as TenantSortField;
  }

  let sortOrder: TenantSortOrder = sortBy === 'createdAt' ? 'desc' : 'asc';
  const rawSortOrder = readTrimmedString(query.sortOrder);
  if (rawSortOrder !== undefined) {
    const normalized = rawSortOrder.toLowerCase();
    if (normalized !== 'asc' && normalized !== 'desc') {
      throw new TenantQueryValidationError(
        'sortOrder must be "asc" or "desc"'
      );
    }
    sortOrder = normalized;
  }

  let limit = DEFAULT_TENANT_QUERY_LIMIT;
  const rawLimit = readTrimmedString(query.limit);
  if (rawLimit !== undefined) {
    const parsed = Number(rawLimit);
    if (
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > MAX_TENANT_QUERY_LIMIT
    ) {
      throw new TenantQueryValidationError(
        `limit must be an integer between 1 and ${MAX_TENANT_QUERY_LIMIT}`
      );
    }
    limit = parsed;
  }

  const nextToken = readTrimmedString(query.nextToken);

  return { filters, search, sortBy, sortOrder, limit, nextToken };
}

/** Apply status/region/subscriptionPlan filters. */
export function filterTenants(
  tenants: TenantRecord[],
  filters: TenantFilterCriteria
): TenantRecord[] {
  return tenants.filter((tenant) => {
    if (filters.status !== undefined && tenant.status !== filters.status) {
      return false;
    }
    if (filters.region !== undefined && tenant.region !== filters.region) {
      return false;
    }
    if (
      filters.subscriptionPlan !== undefined &&
      tenant.subscriptionPlan !== filters.subscriptionPlan
    ) {
      return false;
    }
    return true;
  });
}

/** Case-insensitive free-text search across tenant identity fields. */
export function searchTenants(
  tenants: TenantRecord[],
  term: string
): TenantRecord[] {
  const needle = term.toLowerCase();

  return tenants.filter((tenant) => {
    const haystacks = [
      tenant.tenantId,
      tenant.organizationName,
      tenant.displayName,
      tenant.slug,
      tenant.primaryContact.name,
      tenant.primaryContact.email,
    ];

    return haystacks.some(
      (value) =>
        typeof value === 'string' && value.toLowerCase().includes(needle)
    );
  });
}

function compareByField(
  left: TenantRecord,
  right: TenantRecord,
  sortBy: TenantSortField
): number {
  switch (sortBy) {
    case 'createdAt':
      return (
        new Date(left.createdAt).getTime() -
        new Date(right.createdAt).getTime()
      );
    case 'organizationName':
      return left.organizationName.localeCompare(right.organizationName);
    case 'status':
      return left.status.localeCompare(right.status);
  }
}

/** Sort tenants by the requested field with a stable createdAt/tenantId tie-break. */
export function sortTenants(
  tenants: TenantRecord[],
  sortBy: TenantSortField,
  sortOrder: TenantSortOrder
): TenantRecord[] {
  const direction = sortOrder === 'asc' ? 1 : -1;

  return [...tenants].sort((left, right) => {
    const primary = compareByField(left, right, sortBy) * direction;
    if (primary !== 0) {
      return primary;
    }

    const byCreated =
      new Date(right.createdAt).getTime() -
      new Date(left.createdAt).getTime();
    if (byCreated !== 0) {
      return byCreated;
    }

    return left.tenantId.localeCompare(right.tenantId);
  });
}

interface TenantPageCursor {
  offset: number;
}

function encodePageCursor(offset: number): string {
  return Buffer.from(
    JSON.stringify({ offset } satisfies TenantPageCursor),
    'utf8'
  ).toString('base64url');
}

function decodePageCursor(token: string | undefined): number {
  if (!token) {
    return 0;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(token, 'base64url').toString('utf8')
    ) as Partial<TenantPageCursor> | null;

    if (
      typeof parsed?.offset === 'number' &&
      Number.isInteger(parsed.offset) &&
      parsed.offset >= 0
    ) {
      return parsed.offset;
    }
  } catch {
    // Malformed tokens fall through to the first page.
  }

  return 0;
}

/** Slice a sorted result set into one page with an opaque continuation token. */
export function paginateTenants(
  tenants: TenantRecord[],
  limit: number,
  nextToken?: string
): TenantQueryResult {
  const offset = decodePageCursor(nextToken);
  const page = tenants.slice(offset, offset + limit);
  const nextOffset = offset + page.length;

  return {
    tenants: page,
    total: tenants.length,
    nextToken:
      nextOffset < tenants.length
        ? encodePageCursor(nextOffset)
        : undefined,
  };
}

/** Apply search, filters, sorting, and pagination to the full tenant registry. */
export function applyTenantQuery(
  tenants: TenantRecord[],
  query: TenantQuery
): TenantQueryResult {
  const searched = query.search
    ? searchTenants(tenants, query.search)
    : tenants;

  const filtered = filterTenants(searched, query.filters);
  const sorted = sortTenants(filtered, query.sortBy, query.sortOrder);

  return paginateTenants(sorted, query.limit, query.nextToken);
}

/** Fetch the entire tenant registry, following DynamoDB pagination internally. */
export async function fetchAllTenants(
  listAll: (page?: {
    limit?: number;
    nextToken?: string;
  }) => Promise<{ items: TenantRecord[]; nextToken?: string }>
): Promise<TenantRecord[]> {
  const tenants: TenantRecord[] = [];
  let nextToken: string | undefined;

  do {
    const page = await listAll({ nextToken });
    tenants.push(...page.items);
    nextToken = page.nextToken;
  } while (nextToken);

  return tenants;
}
