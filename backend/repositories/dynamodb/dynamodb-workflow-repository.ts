import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  RepositoryNotFoundError,
  createdAtIndexSortKey,
  decodeNextToken,
  encodeNextToken,
  isConditionalCheckFailure,
  tenantPartitionKey,
  workflowSortKey,
  workflowStatusIndexPartitionKey,
} from '../../database';

import type {
  CreateWorkflowInput,
  PageRequest,
  PageResult,
  UpdateOptions,
  UpdateWorkflowInput,
  WorkflowRepository,
} from '../contracts';

import {
  normalizePageSize,
} from '../contracts/repository-types';

import type {
  WorkflowRecord,
  WorkflowStatus,
} from '../models';

import {
  BaseDynamoDbRepository,
} from './base-dynamodb-repository';

interface WorkflowItem extends WorkflowRecord {
  pk: string;
  sk: string;
  entityType: 'WORKFLOW';
  gsi1pk: string;
  gsi1sk: string;
}

function toWorkflowRecord(
  item: WorkflowItem,
): WorkflowRecord {
  return {
    tenantId: item.tenantId,
    workflowId: item.workflowId,
    status: item.status,
    provider: item.provider,
    resourceId: item.resourceId,
    region: item.region,
    input: item.input,
    result: item.result,
    idempotencyKey: item.idempotencyKey,
    expiresAt: item.expiresAt,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export class DynamoDbWorkflowRepository
  extends BaseDynamoDbRepository
  implements WorkflowRepository
{
  public constructor(
    client: DynamoDBDocumentClient,
    tableName: string,
  ) {
    super(client, tableName);
  }

  public async create(
    input: CreateWorkflowInput,
  ): Promise<WorkflowRecord> {
    const now = new Date().toISOString();

    const record: WorkflowRecord = {
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const item: WorkflowItem = {
      pk: tenantPartitionKey(record.tenantId),
      sk: workflowSortKey(record.workflowId),
      entityType: 'WORKFLOW',
      gsi1pk: workflowStatusIndexPartitionKey(
        record.tenantId,
        record.status,
      ),
      gsi1sk: createdAtIndexSortKey(
        record.createdAt,
        'WORKFLOW',
        record.workflowId,
      ),
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
          `Workflow ${record.workflowId} already exists.`,
        );
      }

      throw error;
    }

    return record;
  }

  public async get(
    tenantId: string,
    workflowId: string,
  ): Promise<WorkflowRecord | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: tenantPartitionKey(tenantId),
          sk: workflowSortKey(workflowId),
        },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return undefined;
    }

    return toWorkflowRecord(
      result.Item as WorkflowItem,
    );
  }

  public async update(
    tenantId: string,
    workflowId: string,
    changes: UpdateWorkflowInput,
    options: UpdateOptions,
  ): Promise<WorkflowRecord> {
    const storageChanges: Record<string, unknown> = {
      ...changes,
    };

    if (changes.status !== undefined) {
      storageChanges.gsi1pk =
        workflowStatusIndexPartitionKey(
          tenantId,
          changes.status,
        );
    }

    const expression =
      this.buildVersionedUpdateExpression(
        storageChanges,
        options.expectedVersion,
      );

    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: tenantPartitionKey(tenantId),
            sk: workflowSortKey(workflowId),
          },
          UpdateExpression: expression.updateExpression,
          ConditionExpression:
            'attribute_exists(pk) AND #version = :expectedVersion',
          ExpressionAttributeNames:
            expression.expressionAttributeNames,
          ExpressionAttributeValues:
            expression.expressionAttributeValues,
          ReturnValues: 'ALL_NEW',
        }),
      );

      if (!result.Attributes) {
        throw new RepositoryNotFoundError(
          `Workflow ${workflowId} was not found.`,
        );
      }

      return toWorkflowRecord(
        result.Attributes as WorkflowItem,
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError(
          `Workflow ${workflowId} could not be updated because its version changed or it no longer exists.`,
        );
      }

      throw error;
    }
  }

  public async delete(
    tenantId: string,
    workflowId: string,
    options?: UpdateOptions,
  ): Promise<void> {
    const expressionAttributeNames:
      | Record<string, string>
      | undefined = options
      ? {
          '#version': 'version',
        }
      : undefined;

    const expressionAttributeValues:
      | Record<string, unknown>
      | undefined = options
      ? {
          ':expectedVersion': options.expectedVersion,
        }
      : undefined;

    const conditionExpression = options
      ? 'attribute_exists(pk) AND #version = :expectedVersion'
      : 'attribute_exists(pk)';

    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            pk: tenantPartitionKey(tenantId),
            sk: workflowSortKey(workflowId),
          },
          ConditionExpression: conditionExpression,
          ExpressionAttributeNames:
            expressionAttributeNames,
          ExpressionAttributeValues:
            expressionAttributeValues,
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError(
          `Workflow ${workflowId} could not be deleted because it does not exist or its version changed.`,
        );
      }

      throw error;
    }
  }

  public async listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<WorkflowRecord>> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression:
          '#pk = :pk AND begins_with(#sk, :workflowPrefix)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(tenantId),
          ':workflowPrefix': 'WORKFLOW#',
        },
        ExclusiveStartKey: decodeNextToken(
          page?.nextToken,
        ),
        Limit: normalizePageSize(page?.limit),
        ScanIndexForward: false,
      }),
    );

    const items = (result.Items ?? []).map((item) =>
      toWorkflowRecord(item as WorkflowItem),
    );

    return {
      items,
      nextToken: encodeNextToken(
        result.LastEvaluatedKey,
      ),
    };
  }

  public async listByStatus(
    tenantId: string,
    status: WorkflowStatus,
    page?: PageRequest,
  ): Promise<PageResult<WorkflowRecord>> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi1',
        KeyConditionExpression:
          '#gsi1pk = :gsi1pk',
        ExpressionAttributeNames: {
          '#gsi1pk': 'gsi1pk',
        },
        ExpressionAttributeValues: {
          ':gsi1pk':
            workflowStatusIndexPartitionKey(
              tenantId,
              status,
            ),
        },
        ExclusiveStartKey: decodeNextToken(
          page?.nextToken,
        ),
        Limit: normalizePageSize(page?.limit),
        ScanIndexForward: false,
      }),
    );

    const items = (result.Items ?? []).map((item) =>
      toWorkflowRecord(item as WorkflowItem),
    );

    return {
      items,
      nextToken: encodeNextToken(
        result.LastEvaluatedKey,
      ),
    };
  }
}