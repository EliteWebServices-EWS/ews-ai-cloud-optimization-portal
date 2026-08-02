/**
 * AWS account connection querying — search, filtering, sorting, and
 * pagination, always scoped to a single tenant (tenant isolation).
 *
 * AwsAccountRepository.listByTenant() supplies one DynamoDB-paginated
 * axis (gsi, Query only — never Scan), and these pure functions apply
 * search/filter/sort/pagination in memory on top of it, so a mock and a
 * DynamoDB-backed repository behave identically.
 */

import type {
  AwsAccountRecord,
  AwsAccountStatus,
} from '../repositories/models/aws-account-persistence-models';
import { AWS_ACCOUNT_ID_PATTERN } from '../repositories/models/aws-account-persistence-models';

const AWS_ACCOUNT_STATUS_VALUES: readonly AwsAccountStatus[] = [
  'PENDING',
  'VALIDATING',
  'VERIFIED',
  'SUSPENDED',
  'DELETED',
];

function isAwsAccountStatus(value: string): value is AwsAccountStatus {
  return (AWS_ACCOUNT_STATUS_VALUES as readonly string[]).includes(value);
}

export const AWS_ACCOUNT_SORT_FIELDS = ['createdAt', 'accountId', 'status'] as const;
export type AwsAccountSortField = (typeof AWS_ACCOUNT_SORT_FIELDS)[number];
export type AwsAccountSortOrder = 'asc' | 'desc';

export const DEFAULT_AWS_ACCOUNT_QUERY_LIMIT = 25;
export const MAX_AWS_ACCOUNT_QUERY_LIMIT = 100;

export interface AwsAccountFilterCriteria {
  status?: AwsAccountStatus;
  region?: string;
}

export interface AwsAccountQuery {
  filters: AwsAccountFilterCriteria;
  search?: string;
  sortBy: AwsAccountSortField;
  sortOrder: AwsAccountSortOrder;
  limit: number;
  nextToken?: string;
}

export interface AwsAccountQueryResult {
  accounts: AwsAccountRecord[];
  total: number;
  nextToken?: string;
}

export class AwsAccountQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AwsAccountQueryValidationError';
  }
}

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function parseAwsAccountQuery(
  query: Record<string, unknown>,
): AwsAccountQuery {
  const filters: AwsAccountFilterCriteria = {};

  const status = readTrimmedString(query.status);
  if (status !== undefined) {
    const normalizedStatus = status.toUpperCase();
    if (!isAwsAccountStatus(normalizedStatus)) {
      throw new AwsAccountQueryValidationError(
        `status must be one of: ${AWS_ACCOUNT_STATUS_VALUES.join(', ')}`,
      );
    }
    filters.status = normalizedStatus;
  }

  filters.region = readTrimmedString(query.region);

  const search = readTrimmedString(query.search);

  let sortBy: AwsAccountSortField = 'createdAt';
  const rawSortBy = readTrimmedString(query.sortBy);
  if (rawSortBy !== undefined) {
    if (!AWS_ACCOUNT_SORT_FIELDS.includes(rawSortBy as AwsAccountSortField)) {
      throw new AwsAccountQueryValidationError(
        `sortBy must be one of: ${AWS_ACCOUNT_SORT_FIELDS.join(', ')}`,
      );
    }
    sortBy = rawSortBy as AwsAccountSortField;
  }

  let sortOrder: AwsAccountSortOrder = sortBy === 'createdAt' ? 'desc' : 'asc';
  const rawSortOrder = readTrimmedString(query.sortOrder);
  if (rawSortOrder !== undefined) {
    const normalized = rawSortOrder.toLowerCase();
    if (normalized !== 'asc' && normalized !== 'desc') {
      throw new AwsAccountQueryValidationError('sortOrder must be "asc" or "desc"');
    }
    sortOrder = normalized;
  }

  let limit = DEFAULT_AWS_ACCOUNT_QUERY_LIMIT;
  const rawLimit = readTrimmedString(query.limit);
  if (rawLimit !== undefined) {
    const parsed = Number(rawLimit);
    if (
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > MAX_AWS_ACCOUNT_QUERY_LIMIT
    ) {
      throw new AwsAccountQueryValidationError(
        `limit must be an integer between 1 and ${MAX_AWS_ACCOUNT_QUERY_LIMIT}`,
      );
    }
    limit = parsed;
  }

  const nextToken = readTrimmedString(query.nextToken);

  return { filters, search, sortBy, sortOrder, limit, nextToken };
}

export function filterAwsAccounts(
  accounts: AwsAccountRecord[],
  filters: AwsAccountFilterCriteria,
): AwsAccountRecord[] {
  return accounts.filter((account) => {
    if (filters.status !== undefined && account.status !== filters.status) {
      return false;
    }
    if (filters.region !== undefined && account.region !== filters.region) {
      return false;
    }
    return true;
  });
}

/** Case-insensitive free-text search across AWS account identity fields. */
export function searchAwsAccounts(
  accounts: AwsAccountRecord[],
  term: string,
): AwsAccountRecord[] {
  const needle = term.toLowerCase();

  return accounts.filter((account) => {
    const haystacks = [account.accountId, account.roleArn, account.region];

    return haystacks.some(
      (value) => typeof value === 'string' && value.toLowerCase().includes(needle),
    );
  });
}

function compareByField(
  left: AwsAccountRecord,
  right: AwsAccountRecord,
  sortBy: AwsAccountSortField,
): number {
  switch (sortBy) {
    case 'createdAt':
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    case 'accountId':
      return left.accountId.localeCompare(right.accountId);
    case 'status':
      return left.status.localeCompare(right.status);
  }
}

export function sortAwsAccounts(
  accounts: AwsAccountRecord[],
  sortBy: AwsAccountSortField,
  sortOrder: AwsAccountSortOrder,
): AwsAccountRecord[] {
  const direction = sortOrder === 'asc' ? 1 : -1;

  return [...accounts].sort((left, right) => {
    const primary = compareByField(left, right, sortBy) * direction;
    if (primary !== 0) {
      return primary;
    }

    const byCreated = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    if (byCreated !== 0) {
      return byCreated;
    }

    return left.accountId.localeCompare(right.accountId);
  });
}

interface AwsAccountPageCursor {
  offset: number;
}

function encodePageCursor(offset: number): string {
  return Buffer.from(
    JSON.stringify({ offset } satisfies AwsAccountPageCursor),
    'utf8',
  ).toString('base64url');
}

function decodePageCursor(token: string | undefined): number {
  if (!token) {
    return 0;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(token, 'base64url').toString('utf8'),
    ) as Partial<AwsAccountPageCursor> | null;

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

export function paginateAwsAccounts(
  accounts: AwsAccountRecord[],
  limit: number,
  nextToken?: string,
): AwsAccountQueryResult {
  const offset = decodePageCursor(nextToken);
  const page = accounts.slice(offset, offset + limit);
  const nextOffset = offset + page.length;

  return {
    accounts: page,
    total: accounts.length,
    nextToken: nextOffset < accounts.length ? encodePageCursor(nextOffset) : undefined,
  };
}

export function applyAwsAccountQuery(
  accounts: AwsAccountRecord[],
  query: AwsAccountQuery,
): AwsAccountQueryResult {
  const searched = query.search ? searchAwsAccounts(accounts, query.search) : accounts;
  const filtered = filterAwsAccounts(searched, query.filters);
  const sorted = sortAwsAccounts(filtered, query.sortBy, query.sortOrder);

  return paginateAwsAccounts(sorted, query.limit, query.nextToken);
}

/**
 * Fetch every AWS account connection for one tenant, following DynamoDB
 * pagination internally. Never crosses tenant boundaries — the caller
 * supplies a tenant-scoped listByTenant function.
 */
export async function fetchAllTenantAwsAccounts(
  listByTenant: (page?: {
    limit?: number;
    nextToken?: string;
  }) => Promise<{ items: AwsAccountRecord[]; nextToken?: string }>,
): Promise<AwsAccountRecord[]> {
  const accounts: AwsAccountRecord[] = [];
  let nextToken: string | undefined;

  do {
    const page = await listByTenant({ nextToken });
    accounts.push(...page.items);
    nextToken = page.nextToken;
  } while (nextToken);

  return accounts;
}

// Re-exported so callers validating a path param can reuse the exact
// pattern the model enforces, without importing two modules.
export { AWS_ACCOUNT_ID_PATTERN };
