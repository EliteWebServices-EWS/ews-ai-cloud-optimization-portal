import {
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  executionHistorySortKey,
  executionHistorySortKeyPrefix,
  RepositoryAlreadyExistsError,
  isConditionalCheckFailure,
  tenantPartitionKey,
} from '../../database';

import {
  decodeScopedNextToken,
  encodeScopedNextToken,
} from '../../persistence/scoped-pagination-token';
import { EXECUTION_PAGINATION_SCOPES } from '../../persistence/execution-pagination-scopes';

import type {
  AppendExecutionHistoryInput,
  ExecutionHistoryRepository,
  PageRequest,
  PageResult,
} from '../contracts';

import { normalizePageSize } from '../contracts/repository-types';

import type { ExecutionHistoryRecord } from '../models';

import {
  validateAppendExecutionHistoryInput,
} from '../models/execution-persistence-models';

interface ExecutionHistoryItem extends ExecutionHistoryRecord {
  pk: string;
  sk: string;
  entityType: 'EXECUTION_HISTORY';
}

function toHistoryRecord(item: ExecutionHistoryItem): ExecutionHistoryRecord {
  return {
    historyId: item.historyId,
    tenantId: item.tenantId,
    executionId: item.executionId,
    workflowId: item.workflowId,
    eventType: item.eventType,
    previousStatus: item.previousStatus,
    nextStatus: item.nextStatus,
    actorId: item.actorId,
    createdAt: item.createdAt,
    details: item.details,
  };
}

export class DynamoDbExecutionHistoryRepository
  implements ExecutionHistoryRepository
{
  public constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {
    if (!tableName.trim()) {
      throw new Error('DynamoDB table name must not be empty.');
    }
  }

  public async append(
    input: AppendExecutionHistoryInput,
  ): Promise<ExecutionHistoryRecord> {
    validateAppendExecutionHistoryInput(input);

    const item: ExecutionHistoryItem = {
      pk: tenantPartitionKey(input.tenantId),
      sk: executionHistorySortKey(
        input.executionId,
        input.createdAt,
        input.historyId,
      ),
      entityType: 'EXECUTION_HISTORY',
      ...input,
    };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression:
            'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryAlreadyExistsError(
          `Execution history ${input.historyId} already exists for execution ${input.executionId}.`,
        );
      }

      throw error;
    }

    return input;
  }

  public async listByExecution(
    tenantId: string,
    executionId: string,
    page?: PageRequest,
  ): Promise<PageResult<ExecutionHistoryRecord>> {
    const scope = EXECUTION_PAGINATION_SCOPES.historyList(
      tenantId,
      executionId,
    );

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression:
          '#pk = :pk AND begins_with(#sk, :historyPrefix)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(tenantId),
          ':historyPrefix': executionHistorySortKeyPrefix(executionId),
        },
        ExclusiveStartKey: decodeScopedNextToken(page?.nextToken, {
          tenantId,
          scope,
        }),
        Limit: normalizePageSize(page?.limit),
        ScanIndexForward: true,
      }),
    );

    const items = (result.Items ?? []).map((item) =>
      toHistoryRecord(item as ExecutionHistoryItem),
    );

    return {
      items,
      nextToken: encodeScopedNextToken(
        { tenantId, scope },
        result.LastEvaluatedKey,
      ),
    };
  }
}
