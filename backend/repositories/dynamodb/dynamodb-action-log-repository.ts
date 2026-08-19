import {
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import { prepareActionLogRecord } from '../../action-log/record-builder';
import type {
  ActionLogRecord,
  RecordActionLogEventInput,
  RecordActionLogEventResult,
} from '../../action-log/types';
import {
  actionLogCanonicalSortKey,
  actionLogCorrelationSortKey,
  actionLogCorrelationSortKeyPrefix,
  actionLogDecisionSortKey,
  actionLogDecisionSortKeyPrefix,
  actionLogExecutionSortKey,
  actionLogExecutionSortKeyPrefix,
  actionLogResourceSortKey,
  actionLogResourceSortKeyPrefix,
  isConditionalCheckFailure,
  tenantPartitionKey,
} from '../../database';
import { ACTION_LOG_PAGINATION_SCOPES } from '../../persistence/action-log-pagination-scopes';
import {
  decodeScopedNextToken,
  encodeScopedNextToken,
} from '../../persistence/scoped-pagination-token';

import type {
  ActionLogRepository,
  PageRequest,
  PageResult,
} from '../contracts';

import { normalizePageSize } from '../contracts/repository-types';

interface ActionLogItem extends ActionLogRecord {
  pk: string;
  sk: string;
  entityType: 'ACTION_LOG';
}

function toActionLogRecord(item: ActionLogItem): ActionLogRecord {
  return {
    eventId: item.eventId,
    logicalEventId: item.logicalEventId,
    tenantId: item.tenantId,
    accountId: item.accountId,
    resourceId: item.resourceId,
    findingKey: item.findingKey,
    decisionId: item.decisionId,
    workflowId: item.workflowId,
    jobId: item.jobId,
    correlationId: item.correlationId,
    executionId: item.executionId,
    eventType: item.eventType,
    eventVersion: item.eventVersion,
    sourceStage: item.sourceStage,
    sourceRecordId: item.sourceRecordId,
    sourceRecordVersion: item.sourceRecordVersion,
    reasonCodes: item.reasonCodes,
    actorType: item.actorType,
    actorId: item.actorId,
    occurredAt: item.occurredAt,
    recordedAt: item.recordedAt,
    orderKey: item.orderKey,
  };
}

function buildItems(record: ActionLogRecord): ActionLogItem[] {
  const pk = tenantPartitionKey(record.tenantId);
  const base: Omit<ActionLogItem, 'sk'> = {
    pk,
    entityType: 'ACTION_LOG',
    ...record,
  };

  const items: ActionLogItem[] = [
    {
      ...base,
      sk: actionLogCanonicalSortKey(record.logicalEventId),
    },
    {
      ...base,
      sk: actionLogCorrelationSortKey({
        correlationId: record.correlationId,
        occurredAt: record.occurredAt,
        orderKey: record.orderKey,
        logicalEventId: record.logicalEventId,
      }),
    },
  ];

  if (record.decisionId) {
    items.push({
      ...base,
      sk: actionLogDecisionSortKey({
        decisionId: record.decisionId,
        occurredAt: record.occurredAt,
        orderKey: record.orderKey,
        logicalEventId: record.logicalEventId,
      }),
    });
  }

  if (record.executionId) {
    items.push({
      ...base,
      sk: actionLogExecutionSortKey({
        executionId: record.executionId,
        occurredAt: record.occurredAt,
        orderKey: record.orderKey,
        logicalEventId: record.logicalEventId,
      }),
    });
  }

  if (record.accountId && record.resourceId) {
    items.push({
      ...base,
      sk: actionLogResourceSortKey({
        accountId: record.accountId,
        resourceId: record.resourceId,
        occurredAt: record.occurredAt,
        orderKey: record.orderKey,
        logicalEventId: record.logicalEventId,
      }),
    });
  }

  return items;
}

export class DynamoDbActionLogRepository implements ActionLogRepository {
  public constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {
    if (!tableName.trim()) {
      throw new Error('DynamoDB table name must not be empty.');
    }
  }

  async recordEvent(
    input: RecordActionLogEventInput,
  ): Promise<RecordActionLogEventResult> {
    const record = prepareActionLogRecord(input);
    const items = buildItems(record);
    const canonical = items[0]!;
    let created = false;
    let persistedRecord = record;

    try {
      await this.putItem(canonical);
      created = true;
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        const existing = await this.getEvent(record.tenantId, record.logicalEventId);
        if (!existing) {
          throw error;
        }
        persistedRecord = existing;
      } else {
        throw error;
      }
    }

    await this.ensureProjectionRows(buildItems(persistedRecord).slice(1));

    return { event: persistedRecord, created };
  }

  private async putItem(item: ActionLogItem): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression:
          'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      }),
    );
  }

  /**
   * Idempotent repair for correlation/decision/execution/resource projections.
   * Safe to call after partial failure or duplicate delivery.
   */
  private async ensureProjectionRows(projections: ActionLogItem[]): Promise<void> {
    for (const item of projections) {
      try {
        await this.putItem(item);
      } catch (error) {
        if (!isConditionalCheckFailure(error)) {
          throw error;
        }
      }
    }
  }

  async getEvent(
    tenantId: string,
    logicalEventId: string,
  ): Promise<ActionLogRecord | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: tenantPartitionKey(tenantId),
          sk: actionLogCanonicalSortKey(logicalEventId),
        },
      }),
    );

    const item = result.Item as ActionLogItem | undefined;
    if (!item || item.entityType !== 'ACTION_LOG') {
      return null;
    }
    if (item.tenantId !== tenantId) {
      return null;
    }
    return toActionLogRecord(item);
  }

  async listByDecision(
    tenantId: string,
    decisionId: string,
    page?: PageRequest,
  ): Promise<PageResult<ActionLogRecord>> {
    return this.queryIndex({
      tenantId,
      skPrefix: actionLogDecisionSortKeyPrefix(decisionId),
      scope: ACTION_LOG_PAGINATION_SCOPES.decisionList(tenantId, decisionId),
      page,
    });
  }

  async listByResource(
    tenantId: string,
    accountId: string,
    resourceId: string,
    page?: PageRequest,
  ): Promise<PageResult<ActionLogRecord>> {
    return this.queryIndex({
      tenantId,
      skPrefix: actionLogResourceSortKeyPrefix(accountId, resourceId),
      scope: ACTION_LOG_PAGINATION_SCOPES.resourceList(
        tenantId,
        accountId,
        resourceId,
      ),
      page,
      accountId,
    });
  }

  async listByCorrelation(
    tenantId: string,
    correlationId: string,
    page?: PageRequest,
  ): Promise<PageResult<ActionLogRecord>> {
    return this.queryIndex({
      tenantId,
      skPrefix: actionLogCorrelationSortKeyPrefix(correlationId),
      scope: ACTION_LOG_PAGINATION_SCOPES.correlationList(
        tenantId,
        correlationId,
      ),
      page,
    });
  }

  async listByExecution(
    tenantId: string,
    executionId: string,
    page?: PageRequest,
  ): Promise<PageResult<ActionLogRecord>> {
    return this.queryIndex({
      tenantId,
      skPrefix: actionLogExecutionSortKeyPrefix(executionId),
      scope: ACTION_LOG_PAGINATION_SCOPES.executionList(tenantId, executionId),
      page,
    });
  }

  private async queryIndex(input: {
    tenantId: string;
    skPrefix: string;
    scope: string;
    page?: PageRequest;
    accountId?: string;
  }): Promise<PageResult<ActionLogRecord>> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(input.tenantId),
          ':skPrefix': input.skPrefix,
        },
        ExclusiveStartKey: decodeScopedNextToken(input.page?.nextToken, {
          tenantId: input.tenantId,
          scope: input.scope,
        }),
        Limit: normalizePageSize(input.page?.limit),
        ScanIndexForward: true,
      }),
    );

    const items = (result.Items ?? [])
      .map((item) => toActionLogRecord(item as ActionLogItem))
      .filter((record) => {
        if (record.tenantId !== input.tenantId) {
          return false;
        }
        if (input.accountId && record.accountId !== input.accountId) {
          return false;
        }
        return true;
      });

    return {
      items,
      nextToken: encodeScopedNextToken(
        { tenantId: input.tenantId, scope: input.scope },
        result.LastEvaluatedKey,
      ),
    };
  }
}
