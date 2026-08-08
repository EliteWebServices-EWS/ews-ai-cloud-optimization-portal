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
  | 'VERIFICATION'
  | 'EXECUTION'
  | 'COST_FINDING';

export type OwnedResourceType = BusinessResourceType;

/**
 * Validates a value before using it inside a DynamoDB composite key.
 */
export function requireKeyValue(value: string, fieldName: string): string {
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

export function costFindingSortKey(findingId: string): string {
  return resourceSortKey('COST_FINDING', findingId);
}

/**
 * Creates the GSI partition key used to list cost findings for a specific
 * AWS account within a tenant.
 *
 * Example:
 * TENANT#tenant-a#ACCOUNT#111111111111
 */
export function accountResourceIndexPartitionKey(
  tenantId: string,
  accountId: string,
): string {
  return `${tenantPartitionKey(tenantId)}#ACCOUNT#${requireKeyValue(accountId, 'accountId')}`;
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
 * Creates the sort key for a tenant membership record.
 *
 * Example:
 * MEMBER#user-123
 */
export function membershipSortKey(userId: string): string {
  return `MEMBER#${requireKeyValue(userId, 'userId')}`;
}

/** Fixed sort key for the one-time tenant-owner bootstrap marker (same table as memberships). */
export const TENANT_OWNER_BOOTSTRAP_SORT_KEY = 'OWNER_BOOTSTRAP';

/**
 * Creates the GSI1 partition key used to list every tenant a user belongs
 * to, across tenants.
 *
 * Example:
 * USER#user-123
 */
export function userMembershipIndexPartitionKey(userId: string): string {
  return `USER#${requireKeyValue(userId, 'userId')}`;
}

/**
 * Creates the GSI1 sort key for the user-membership index.
 *
 * Example:
 * TENANT#tenant-a#MEMBER#user-123
 */
export function userMembershipIndexSortKey(
  tenantId: string,
  userId: string,
): string {
  return `${tenantPartitionKey(tenantId)}#${membershipSortKey(userId)}`;
}

/**
 * Creates the GSI2 partition key used to resolve a membership by its
 * opaque memberId (used by memberId-only routes such as
 * PATCH/DELETE /members/{memberId}).
 *
 * Example:
 * MEMBERID#mem-abc123
 */
export function memberIdIndexPartitionKey(memberId: string): string {
  return `MEMBERID#${requireKeyValue(memberId, 'memberId')}`;
}

export const MEMBER_ID_INDEX_SORT_KEY = 'MEMBER';

/**
 * Creates the sort key for an invitation record.
 *
 * Example:
 * INVITE#inv-123
 */
export function invitationSortKey(invitationId: string): string {
  return `INVITE#${requireKeyValue(invitationId, 'invitationId')}`;
}

/**
 * Creates the GSI1 partition key used to resolve an invitation by the hash
 * of its bearer token (never by the raw token — the raw token is never
 * persisted or queried against).
 *
 * Example:
 * INVITETOKEN#3f9a...
 */
export function invitationTokenIndexPartitionKey(tokenHash: string): string {
  return `INVITETOKEN#${requireKeyValue(tokenHash, 'tokenHash')}`;
}

export const INVITATION_TOKEN_INDEX_SORT_KEY = 'INVITE';

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