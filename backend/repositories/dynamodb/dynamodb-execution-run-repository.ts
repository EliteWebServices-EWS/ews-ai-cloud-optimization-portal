import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  executionRunSortKey,
  EXECUTION_RUN_SK_PREFIX,
  isConditionalCheckFailure,
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  RepositoryNotFoundError,
  tenantPartitionKey,
} from '../../database';

import type {
  CreateExecutionRunInput,
  ExecutionRunRepository,
  UpdateExecutionRunInput,
  UpdateOptions,
} from '../contracts';

import type { ExecutionRunRecord } from '../models/execution-run-models';

import { BaseDynamoDbRepository } from './base-dynamodb-repository';
import {
  decodeScopedNextToken,
  encodeScopedNextToken,
} from '../../persistence/scoped-pagination-token';
import { EXECUTION_PAGINATION_SCOPES } from '../../persistence/execution-pagination-scopes';
import { normalizePageSize } from '../contracts/repository-types';
import type { PageRequest, PageResult } from '../contracts/repository-types';

interface ExecutionRunItem extends ExecutionRunRecord {
  pk: string;
  sk: string;
  entityType: 'EXECUTION_RUN';
}

function toRecord(item: ExecutionRunItem): ExecutionRunRecord {
  return {
    tenantId: item.tenantId,
    runId: item.runId,
    correlationId: item.correlationId,
    requestId: item.requestId,
    actorId: item.actorId,
    workflowId: item.workflowId,
    mode: item.mode,
    service: item.service,
    action: item.action,
    resourceId: item.resourceId,
    region: item.region,
    status: item.status,
    rollbackState: item.rollbackState,
    previousConfiguration: item.previousConfiguration,
    executionSnapshot: item.executionSnapshot,
    validationResult: item.validationResult,
    executionResult: item.executionResult,
    verificationResult: item.verificationResult,
    rollbackResult: item.rollbackResult,
    dryRunPlan: item.dryRunPlan,
    failure: item.failure,
    rollbackFailure: item.rollbackFailure,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export class DynamoDbExecutionRunRepository
  extends BaseDynamoDbRepository
  implements ExecutionRunRepository
{
  public constructor(
    client: DynamoDBDocumentClient,
    tableName: string,
  ) {
    super(client, tableName);
  }

  public async create(
    input: CreateExecutionRunInput,
  ): Promise<ExecutionRunRecord> {
    const now = new Date().toISOString();
    const record: ExecutionRunRecord = {
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const item: ExecutionRunItem = {
      pk: tenantPartitionKey(record.tenantId),
      sk: executionRunSortKey(record.runId),
      entityType: 'EXECUTION_RUN',
      ...record,
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
          `Execution run ${record.runId} already exists for tenant ${record.tenantId}.`,
        );
      }

      throw error;
    }

    return record;
  }

  public async getById(
    tenantId: string,
    runId: string,
  ): Promise<ExecutionRunRecord | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: tenantPartitionKey(tenantId),
          sk: executionRunSortKey(runId),
        },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return undefined;
    }

    return toRecord(result.Item as ExecutionRunItem);
  }

  public async update(
    tenantId: string,
    runId: string,
    changes: UpdateExecutionRunInput,
    options: UpdateOptions,
  ): Promise<ExecutionRunRecord> {
    const existing = await this.getById(tenantId, runId);
    if (!existing) {
      throw new RepositoryNotFoundError(
        `Execution run ${runId} was not found.`,
      );
    }

    const update = this.buildVersionedUpdateExpression(
      changes,
      options.expectedVersion ?? existing.version,
    );

    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: tenantPartitionKey(tenantId),
            sk: executionRunSortKey(runId),
          },
          UpdateExpression: update.updateExpression,
          ExpressionAttributeNames: update.expressionAttributeNames,
          ExpressionAttributeValues: update.expressionAttributeValues,
          ConditionExpression: '#version = :expectedVersion',
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError();
      }

      throw error;
    }

    const refreshed = await this.getById(tenantId, runId);
    if (!refreshed) {
      throw new RepositoryNotFoundError(
        `Execution run ${runId} was not found after update.`,
      );
    }

    return refreshed;
  }

  public async listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<ExecutionRunRecord>> {
    const scope = EXECUTION_PAGINATION_SCOPES.runList(tenantId);

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression:
          '#pk = :pk AND begins_with(#sk, :runPrefix)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(tenantId),
          ':runPrefix': EXECUTION_RUN_SK_PREFIX,
        },
        ExclusiveStartKey: decodeScopedNextToken(page?.nextToken, {
          tenantId,
          scope,
        }),
        Limit: normalizePageSize(page?.limit),
        ScanIndexForward: false,
      }),
    );

    const items = (result.Items ?? []).map((item) =>
      toRecord(item as ExecutionRunItem),
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
