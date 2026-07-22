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
  learningSortKey,
  tenantPartitionKey,
  workflowResourceIndexPartitionKey,
} from '../../database';

import type {
  CreateLearningInput,
  LearningRepository,
  PageRequest,
  PageResult,
  UpdateLearningInput,
  UpdateOptions,
} from '../contracts';

import { normalizePageSize } from '../contracts/repository-types';

import type { LearningRecord } from '../models';

import { BaseDynamoDbRepository } from './base-dynamodb-repository';

interface LearningItem extends LearningRecord {
  pk: string;
  sk: string;
  entityType: 'LEARNING';
  gsi1pk?: string;
  gsi1sk: string;
}

/**
 * Removes DynamoDB-only fields before returning a learning record.
 */
function toLearningRecord(
  item: LearningItem,
): LearningRecord {
  return {
    tenantId: item.tenantId,
    learningId: item.learningId,
    workflowId: item.workflowId,
    feedbackType: item.feedbackType,
    payload: item.payload,
    expiresAt: item.expiresAt,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export class DynamoDbLearningRepository
  extends BaseDynamoDbRepository
  implements LearningRepository
{
  public constructor(
    client: DynamoDBDocumentClient,
    tableName: string,
  ) {
    super(client, tableName);
  }

  /**
   * Creates a learning record without overwriting an existing one.
   */
  public async create(
    input: CreateLearningInput,
  ): Promise<LearningRecord> {
    const now = new Date().toISOString();

    const record: LearningRecord = {
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const item: LearningItem = {
      pk: tenantPartitionKey(record.tenantId),
      sk: learningSortKey(record.learningId),
      entityType: 'LEARNING',
      gsi1sk: createdAtIndexSortKey(
        record.createdAt,
        'LEARNING',
        record.learningId,
      ),
      ...record,
    };

    if (record.workflowId) {
      item.gsi1pk = workflowResourceIndexPartitionKey(
        record.tenantId,
        record.workflowId,
      );
    }

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
          `Learning record ${record.learningId} already exists.`,
        );
      }

      throw error;
    }

    return record;
  }

  /**
   * Gets one learning record using tenant-scoped keys.
   */
  public async get(
    tenantId: string,
    learningId: string,
  ): Promise<LearningRecord | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: tenantPartitionKey(tenantId),
          sk: learningSortKey(learningId),
        },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return undefined;
    }

    return toLearningRecord(
      result.Item as LearningItem,
    );
  }

  /**
   * Updates a learning record using optimistic locking.
   */
  public async update(
    tenantId: string,
    learningId: string,
    changes: UpdateLearningInput,
    options: UpdateOptions,
  ): Promise<LearningRecord> {
    const storageChanges: Record<string, unknown> = {
      ...changes,
    };

    if (changes.workflowId !== undefined) {
      storageChanges.gsi1pk =
        workflowResourceIndexPartitionKey(
          tenantId,
          changes.workflowId,
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
            sk: learningSortKey(learningId),
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
          `Learning record ${learningId} was not found.`,
        );
      }

      return toLearningRecord(
        result.Attributes as LearningItem,
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError(
          `Learning record ${learningId} could not be updated because its version changed or it no longer exists.`,
        );
      }

      throw error;
    }
  }

  /**
   * Deletes a learning record.
   */
  public async delete(
    tenantId: string,
    learningId: string,
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
            sk: learningSortKey(learningId),
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
          `Learning record ${learningId} could not be deleted because it does not exist or its version changed.`,
        );
      }

      throw error;
    }
  }

  /**
   * Lists learning records for one tenant.
   */
  public async listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<LearningRecord>> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression:
          '#pk = :pk AND begins_with(#sk, :learningPrefix)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(tenantId),
          ':learningPrefix': 'LEARNING#',
        },
        ExclusiveStartKey: decodeNextToken(
          page?.nextToken,
        ),
        Limit: normalizePageSize(page?.limit),
        ScanIndexForward: false,
      }),
    );

    const items = (result.Items ?? []).map((item) =>
      toLearningRecord(item as LearningItem),
    );

    return {
      items,
      nextToken: encodeNextToken(
        result.LastEvaluatedKey,
      ),
    };
  }

  /**
   * Lists learning records belonging to one workflow using gsi1.
   */
  public async listByWorkflow(
    tenantId: string,
    workflowId: string,
    page?: PageRequest,
  ): Promise<PageResult<LearningRecord>> {
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
            workflowResourceIndexPartitionKey(
              tenantId,
              workflowId,
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
      toLearningRecord(item as LearningItem),
    );

    return {
      items,
      nextToken: encodeNextToken(
        result.LastEvaluatedKey,
      ),
    };
  }
}