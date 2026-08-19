import {
  requireKeyValue,
  requireOpaqueKeyValue,
} from '../dynamodb-keys';

const ACTION_LOG_PREFIX = 'ACTION_LOG' as const;

export function actionLogCanonicalSortKey(logicalEventId: string): string {
  return `${ACTION_LOG_PREFIX}#LOG#${requireKeyValue(logicalEventId, 'logicalEventId')}`;
}

export function actionLogCanonicalSortKeyPrefix(): string {
  return `${ACTION_LOG_PREFIX}#LOG#`;
}

export function actionLogCorrelationSortKeyPrefix(correlationId: string): string {
  return `${ACTION_LOG_PREFIX}#CORR#${requireKeyValue(correlationId, 'correlationId')}#`;
}

export function actionLogCorrelationSortKey(input: {
  correlationId: string;
  occurredAt: string;
  orderKey: string;
  logicalEventId: string;
}): string {
  return `${actionLogCorrelationSortKeyPrefix(input.correlationId)}OCCURRED_AT#${requireKeyValue(
    input.occurredAt,
    'occurredAt',
  )}#ORDER#${requireOpaqueKeyValue(input.orderKey, 'orderKey')}#LOG#${requireKeyValue(
    input.logicalEventId,
    'logicalEventId',
  )}`;
}

export function actionLogDecisionSortKeyPrefix(decisionId: string): string {
  return `${ACTION_LOG_PREFIX}#DEC#${requireKeyValue(decisionId, 'decisionId')}#`;
}

export function actionLogDecisionSortKey(input: {
  decisionId: string;
  occurredAt: string;
  orderKey: string;
  logicalEventId: string;
}): string {
  return `${actionLogDecisionSortKeyPrefix(input.decisionId)}OCCURRED_AT#${requireKeyValue(
    input.occurredAt,
    'occurredAt',
  )}#ORDER#${requireOpaqueKeyValue(input.orderKey, 'orderKey')}#LOG#${requireKeyValue(
    input.logicalEventId,
    'logicalEventId',
  )}`;
}

export function actionLogExecutionSortKeyPrefix(executionId: string): string {
  return `${ACTION_LOG_PREFIX}#EXEC#${requireKeyValue(executionId, 'executionId')}#`;
}

export function actionLogExecutionSortKey(input: {
  executionId: string;
  occurredAt: string;
  orderKey: string;
  logicalEventId: string;
}): string {
  return `${actionLogExecutionSortKeyPrefix(input.executionId)}OCCURRED_AT#${requireKeyValue(
    input.occurredAt,
    'occurredAt',
  )}#ORDER#${requireOpaqueKeyValue(input.orderKey, 'orderKey')}#LOG#${requireKeyValue(
    input.logicalEventId,
    'logicalEventId',
  )}`;
}

export function actionLogResourceSortKeyPrefix(
  accountId: string,
  resourceId: string,
): string {
  return `${ACTION_LOG_PREFIX}#RES#${requireKeyValue(accountId, 'accountId')}#${requireKeyValue(
    resourceId,
    'resourceId',
  )}#`;
}

export function actionLogResourceSortKey(input: {
  accountId: string;
  resourceId: string;
  occurredAt: string;
  orderKey: string;
  logicalEventId: string;
}): string {
  return `${actionLogResourceSortKeyPrefix(input.accountId, input.resourceId)}OCCURRED_AT#${requireKeyValue(
    input.occurredAt,
    'occurredAt',
  )}#ORDER#${requireOpaqueKeyValue(input.orderKey, 'orderKey')}#LOG#${requireKeyValue(
    input.logicalEventId,
    'logicalEventId',
  )}`;
}
