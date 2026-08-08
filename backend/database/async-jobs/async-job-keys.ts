import { createHash } from 'node:crypto';

import { requireKeyValue, tenantPartitionKey } from '../dynamodb-keys';

export const EC2_ASYNC_JOB_TYPE = 'EC2_INTELLIGENCE' as const;

export function asyncJobSortKey(jobId: string): string {
  return `ASYNC_JOB#${requireKeyValue(jobId, 'jobId')}`;
}

export function asyncJobIdempotencySortKey(idempotencyKey: string): string {
  return `ASYNC_JOB_IDEM#${requireKeyValue(idempotencyKey, 'idempotencyKey')}`;
}

export function asyncJobEventSortKey(jobId: string, eventId: string): string {
  return `ASYNC_JOB#${requireKeyValue(jobId, 'jobId')}#EVENT#${requireKeyValue(eventId, 'eventId')}`;
}

export function asyncJobTenantListIndexPartitionKey(tenantId: string): string {
  return `${tenantPartitionKey(tenantId)}#ASYNC_JOBS`;
}

export function asyncJobTenantListIndexSortKey(createdAt: string, jobId: string): string {
  return `${createdAt}#${requireKeyValue(jobId, 'jobId')}`;
}

export function buildEc2AsyncJobRequestFingerprint(input: {
  accountId: string;
  regions: string[];
  jobType: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        accountId: input.accountId,
        jobType: input.jobType,
        regions: [...input.regions].sort(),
      }),
    )
    .digest('hex');
}
