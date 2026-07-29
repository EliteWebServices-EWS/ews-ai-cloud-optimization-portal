import {
  createdAtIndexSortKey,
  requireKeyValue,
  tenantPartitionKey,
} from '../dynamodb-keys';

const EXECUTION_RESOURCE = 'EXECUTION' as const;
const EXECUTION_HISTORY_PREFIX = 'EXECUTION_HIST';

/**
 * Sort key for a durable execution plan record.
 *
 * Example: EXECUTION#exec-123
 */
export function executionPlanSortKey(executionId: string): string {
  return `${EXECUTION_RESOURCE}#${requireKeyValue(executionId, 'executionId')}`;
}

/**
 * GSI1 — list execution plans for a workflow (newest first via CREATED_AT sort key).
 */
export function executionWorkflowIndexPartitionKey(
  tenantId: string,
  workflowId: string,
): string {
  return `${tenantPartitionKey(tenantId)}#WORKFLOW#${requireKeyValue(
    workflowId,
    'workflowId',
  )}`;
}

export function executionWorkflowIndexSortKey(
  createdAt: string,
  executionId: string,
): string {
  return createdAtIndexSortKey(
    createdAt,
    EXECUTION_RESOURCE,
    executionId,
  );
}

/**
 * GSI2 — list execution plans by tenant-scoped plan status.
 */
export function executionStatusIndexPartitionKey(
  tenantId: string,
  planStatus: string,
): string {
  return `${tenantPartitionKey(tenantId)}#EXECUTION_STATUS#${requireKeyValue(
    planStatus,
    'planStatus',
  )}`;
}

export function executionStatusIndexSortKey(
  createdAt: string,
  executionId: string,
): string {
  return createdAtIndexSortKey(
    createdAt,
    EXECUTION_RESOURCE,
    executionId,
  );
}

export function executionHistorySortKeyPrefix(executionId: string): string {
  return `${EXECUTION_HISTORY_PREFIX}#${requireKeyValue(
    executionId,
    'executionId',
  )}#`;
}

/**
 * Append-only execution history sort key (chronological query under tenant PK).
 *
 * Example:
 * EXECUTION_HIST#exec-1#CREATED_AT#2026-07-29T10:00:00.000Z#hist-abc
 */
export function executionHistorySortKey(
  executionId: string,
  createdAt: string,
  historyId: string,
): string {
  return `${executionHistorySortKeyPrefix(executionId)}CREATED_AT#${requireKeyValue(
    createdAt,
    'createdAt',
  )}#${requireKeyValue(historyId, 'historyId')}`;
}

export const EXECUTION_PLAN_SK_PREFIX = `${EXECUTION_RESOURCE}#`;
