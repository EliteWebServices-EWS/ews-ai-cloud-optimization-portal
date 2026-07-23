/**
 * DynamoDB key helpers for tenant-owned SISU'M business records.
 *
 * Tenant IDs must come from the authenticated server-side request context.
 * Never use a browser-provided tenant header to construct these keys.
 */

export type BusinessResourceType =
  | 'WORKFLOW'
  | 'REPORT'
  | 'LEARNING'
  | 'VERIFICATION';

export type OwnedResourceType = BusinessResourceType;

/**
 * Validates a value before using it inside a DynamoDB composite key.
 */
function requireKeyValue(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new Error(`${fieldName} must not be empty`);
  }

  if (normalizedValue.includes('#')) {
    throw new Error(`${fieldName} must not contain #`);
  }

  return normalizedValue;
}

/**
 * Creates the partition key for a tenant-owned record.
 *
 * Example:
 * TENANT#tenant-a
 */
export function tenantPartitionKey(tenantId: string): string {
  return `TENANT#${requireKeyValue(tenantId, 'tenantId')}`;
}

/**
 * Creates the sort key for a business resource.
 *
 * Example:
 * WORKFLOW#wf-123
 */
export function resourceSortKey(
  resourceType: BusinessResourceType,
  resourceId: string,
): string {
  return `${resourceType}#${requireKeyValue(resourceId, 'resourceId')}`;
}

export function workflowSortKey(workflowId: string): string {
  return resourceSortKey('WORKFLOW', workflowId);
}

export function reportSortKey(reportId: string): string {
  return resourceSortKey('REPORT', reportId);
}

export function learningSortKey(learningId: string): string {
  return resourceSortKey('LEARNING', learningId);
}

export function verificationSortKey(verificationId: string): string {
  return resourceSortKey('VERIFICATION', verificationId);
}

/**
 * Creates the partition key for the durable ownership index.
 *
 * Example:
 * RESOURCE#WORKFLOW#wf-123
 */
export function ownershipPartitionKey(
  resourceType: OwnedResourceType,
  resourceId: string,
): string {
  return `RESOURCE#${resourceType}#${requireKeyValue(
    resourceId,
    'resourceId',
  )}`;
}

/**
 * All ownership records use this fixed sort key.
 */
export const OWNERSHIP_SORT_KEY = 'OWNERSHIP';

/**
 * Creates the GSI partition key used to list workflows by status.
 *
 * Example:
 * TENANT#tenant-a#WORKFLOW_STATUS#COMPLETED
 */
export function workflowStatusIndexPartitionKey(
  tenantId: string,
  status: string,
): string {
  return `${tenantPartitionKey(
    tenantId,
  )}#WORKFLOW_STATUS#${requireKeyValue(status, 'status')}`;
}

/**
 * Creates the GSI partition key used to list records for a workflow.
 *
 * Example:
 * TENANT#tenant-a#WORKFLOW#wf-123
 */
export function workflowResourceIndexPartitionKey(
  tenantId: string,
  workflowId: string,
): string {
  return `${tenantPartitionKey(
    tenantId,
  )}#WORKFLOW#${requireKeyValue(workflowId, 'workflowId')}`;
}

/**
 * Creates a chronological GSI sort key.
 *
 * Example:
 * CREATED_AT#2026-07-22T10:00:00.000Z#REPORT#report-123
 */
export function createdAtIndexSortKey(
  createdAt: string,
  resourceType: BusinessResourceType,
  resourceId: string,
): string {
  return `CREATED_AT#${requireKeyValue(
    createdAt,
    'createdAt',
  )}#${resourceSortKey(resourceType, resourceId)}`;
}