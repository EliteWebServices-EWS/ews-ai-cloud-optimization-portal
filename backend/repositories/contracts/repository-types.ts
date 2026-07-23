/**
 * Input used by repository list methods.
 */
export interface PageRequest {
  limit?: number;
  nextToken?: string;
}

/**
 * Standard result returned by paginated repository queries.
 */
export interface PageResult<T> {
  items: T[];
  nextToken?: string;
}

/**
 * Common identity for tenant-owned records.
 */
export interface TenantRecordIdentity {
  tenantId: string;
}

/**
 * Common fields for records that support optimistic locking.
 */
export interface VersionedRecord {
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Options required for version-controlled updates.
 */
export interface UpdateOptions {
  expectedVersion: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/**
 * Ensures page size stays inside an approved range.
 */
export function normalizePageSize(limit?: number): number {
  if (limit === undefined) {
    return DEFAULT_PAGE_SIZE;
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      'Pagination limit must be a positive integer.',
    );
  }

  return Math.min(limit, MAX_PAGE_SIZE);
}