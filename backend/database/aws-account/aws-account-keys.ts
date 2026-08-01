import {
  requireKeyValue,
  tenantPartitionKey,
} from '../dynamodb-keys';

const AWS_ACCOUNT_RESOURCE = 'AWS_ACCOUNT' as const;

export const AWS_ACCOUNT_SK_PREFIX = `${AWS_ACCOUNT_RESOURCE}#`;

export function awsAccountSortKey(accountId: string): string {
  return `${AWS_ACCOUNT_RESOURCE}#${requireKeyValue(accountId, 'accountId')}`;
}

/** GSI1 — resolve registration by AWS account ID (platform/internal). */
export function awsAccountGlobalIndexPartitionKey(accountId: string): string {
  return `${AWS_ACCOUNT_RESOURCE}#${requireKeyValue(accountId, 'accountId')}`;
}

export function awsAccountGlobalIndexSortKey(tenantId: string): string {
  return tenantPartitionKey(tenantId);
}

/** GSI2 — list accounts for a tenant filtered by lifecycle status. */
export function awsAccountStatusIndexPartitionKey(
  tenantId: string,
  status: string,
): string {
  return `${tenantPartitionKey(tenantId)}#AWS_ACCOUNT_STATUS#${requireKeyValue(
    status,
    'status',
  )}`;
}

export function awsAccountStatusIndexSortKey(
  updatedAt: string,
  accountId: string,
): string {
  return `UPDATED_AT#${requireKeyValue(
    updatedAt,
    'updatedAt',
  )}#${awsAccountSortKey(accountId)}`;
}

/** Uniqueness lock item — one registration per AWS account ID (Option A). */
export function awsAccountLockPartitionKey(accountId: string): string {
  return `AWS_ACCOUNT_LOCK#${requireKeyValue(accountId, 'accountId')}`;
}

export const AWS_ACCOUNT_LOCK_SORT_KEY = 'LOCK';
