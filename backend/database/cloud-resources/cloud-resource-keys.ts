import { requireKeyValue, requireOpaqueKeyValue, tenantPartitionKey } from '../dynamodb-keys';

const CLOUD_RESOURCE_ENTITY = 'CLOUD_RESOURCE' as const;
const EC2_DISCOVERY_RUN_ENTITY = 'EC2_DISCOVERY_RUN' as const;

export const CLOUD_RESOURCE_SK_PREFIX = `${CLOUD_RESOURCE_ENTITY}#`;
export const EC2_DISCOVERY_RUN_SK_PREFIX = `${EC2_DISCOVERY_RUN_ENTITY}#`;

/** Tenant + AWS account scope for inventory and discovery runs. */
export function cloudResourceAccountPartitionKey(
  tenantId: string,
  accountId: string,
): string {
  return `${tenantPartitionKey(tenantId)}#AWS_ACCOUNT#${requireKeyValue(
    accountId,
    'accountId',
  )}`;
}

export function cloudResourceSortKey(
  region: string,
  resourceType: string,
  resourceId: string,
): string {
  return `${CLOUD_RESOURCE_SK_PREFIX}${requireKeyValue(region, 'region')}#SERVICE#ec2#TYPE#${requireKeyValue(
    resourceType,
    'resourceType',
  )}#ID#${requireKeyValue(resourceId, 'resourceId')}`;
}

export function ec2DiscoveryRunSortKey(runId: string): string {
  return `${EC2_DISCOVERY_RUN_SK_PREFIX}${requireOpaqueKeyValue(runId, 'runId')}`;
}

/** GSI1 — list resources for tenant/account (optionally filtered by begins_with on sk pattern via pk query). */
export function cloudResourceTenantAccountIndexPartitionKey(
  tenantId: string,
  accountId: string,
): string {
  return cloudResourceAccountPartitionKey(tenantId, accountId);
}

export function cloudResourceTenantAccountIndexSortKey(
  region: string,
  resourceType: string,
  resourceId: string,
): string {
  return `${requireKeyValue(region, 'region')}#${requireKeyValue(
    resourceType,
    'resourceType',
  )}#${requireKeyValue(resourceId, 'resourceId')}`;
}

export function cloudResourceSortKeyPrefixForAccount(): string {
  return CLOUD_RESOURCE_SK_PREFIX;
}

export function cloudResourceSortKeyPrefixForType(
  region: string,
  resourceType: string,
): string {
  return `${CLOUD_RESOURCE_SK_PREFIX}${requireKeyValue(region, 'region')}#SERVICE#ec2#TYPE#${requireKeyValue(
    resourceType,
    'resourceType',
  )}#`;
}
