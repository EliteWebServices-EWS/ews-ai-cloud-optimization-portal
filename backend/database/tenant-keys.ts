function requireTenantKeyValue(
  value: string,
  fieldName: string,
): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${fieldName} must not be empty.`);
  }

  if (normalized.includes('#')) {
    throw new Error(`${fieldName} must not contain #.`);
  }

  return normalized;
}

export function normalizeTenantSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();

  if (!normalized) {
    throw new Error('slug must not be empty.');
  }

  if (normalized.includes('#')) {
    throw new Error('slug must not contain #.');
  }

  return normalized;
}

export function tenantRegistryPartitionKey(
  tenantId: string,
): string {
  return `TENANT#${requireTenantKeyValue(
    tenantId,
    'tenantId',
  )}`;
}

export const TENANT_REGISTRY_SORT_KEY = 'TENANT';

export function tenantSlugIndexPartitionKey(
  slug: string,
): string {
  return `TENANT_SLUG#${normalizeTenantSlug(slug)}`;
}

export function tenantOwnerIndexPartitionKey(
  ownerUserId: string,
): string {
  return `TENANT_OWNER#${requireTenantKeyValue(
    ownerUserId,
    'ownerUserId',
  )}`;
}

export function tenantStatusIndexPartitionKey(
  status: string,
): string {
  return `TENANT_STATUS#${requireTenantKeyValue(
    status,
    'status',
  )}`;
}

export function tenantCreatedAtSortKey(
  createdAt: string,
  tenantId: string,
): string {
  return [
    'CREATED_AT',
    requireTenantKeyValue(createdAt, 'createdAt'),
    'TENANT',
    requireTenantKeyValue(tenantId, 'tenantId'),
  ].join('#');
}

export function tenantSlugReservationPartitionKey(
  slug: string,
): string {
  return tenantSlugIndexPartitionKey(slug);
}

export const TENANT_SLUG_RESERVATION_SORT_KEY =
  'RESERVATION';

/**
 * Fixed partition key for the platform-wide tenant registry index (gsi4),
 * used only by administration listing (Platform Admin). Every tenant
 * shares this single partition, sorted by tenantCreatedAtSortKey — the
 * same tradeoff the reporting engine already documents: registry sizes at
 * this platform's scale are small enough to query and paginate fully.
 */
export const TENANT_REGISTRY_INDEX_PARTITION_KEY =
  'TENANT_REGISTRY_ALL';