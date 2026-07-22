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
  verificationSortKey,
  workflowResourceIndexPartitionKey,
} from '../../database';

import type {
  CreateVerificationInput,
  PageRequest,
  PageResult,
  UpdateOptions,
  UpdateVerificationInput,
  VerificationRepository,
} from '../contracts';

import { normalizePageSize } from '../contracts/repository-types';

import type { VerificationRecord } from '../models';

import { BaseDynamoDbRepository } from './base-dynamodb-repository';

interface VerificationItem extends VerificationRecord {
  pk: string;
  sk: string;
  entityType: 'VERIFICATION';
  gsi1pk?: string;
  gsi1sk: string;
}

function toVerificationRecord(
  item: VerificationItem,
): VerificationRecord {
  return {
    tenantId: item.tenantId,
    verificationId: item.verificationId,
    workflowId: item.workflowId,
    outcome: item.outcome,
    payload: item.payload,
    expiresAt: item.expiresAt,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export class DynamoDbVerificationRepository
  extends BaseDynamoDbRepository
  implements VerificationRepository
{
  public constructor(
    client: DynamoDBDocumentClient,
    tableName: string,
  ) {
    super(client, tableName);
  }

  public async create(
    input: CreateVerificationInput,
  ): Promise<VerificationRecord> {
    const now = new Date().toISOString();

    const record: VerificationRecord = {
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const item: VerificationItem = {
      pk: tenantPartitionKey(record.tenantId),
      sk: verificationSortKey(record.verificationId),
      entityType: 'VERIFICATION',
      gsi1sk: createdAtIndexSortKey(
        record.createdAt,
        'VERIFICATION',
        record.verificationId,
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
          `Verification record ${record.verificationId} already exists.`,
        );
      }

      throw error;
    }

    return record;
  }

  public async get(
    tenantId: string,
    verificationId: string,
  ): Promise<VerificationRecord | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: tenantPartitionKey(tenantId),
          sk: verificationSortKey(verificationId),
        },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return undefined;
    }

    return toVerificationRecord(
      result.Item as VerificationItem,
    );
  }

  public async update(
    tenantId: string,
    verificationId: string,
    changes: UpdateVerificationInput,
    options: UpdateOptions,
  ): Promise<VerificationRecord> {
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
            sk: verificationSortKey(verificationId),
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
          `Verification record ${verificationId} was not found.`,
        );
      }

      return toVerificationRecord(
        result.Attributes as VerificationItem,
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError(
          `Verification record ${verificationId} could not be updated because its version changed or it no longer exists.`,
        );
      }

      throw error;
    }
  }

  public async delete(
    tenantId: string,
    verificationId: string,
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
            sk: verificationSortKey(verificationId),
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
          `Verification record ${verificationId} could not be deleted because it does not exist or its version changed.`,
        );
      }

      throw error;
    }
  }

  public async listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<VerificationRecord>> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression:
          '#pk = :pk AND begins_with(#sk, :verificationPrefix)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(tenantId),
          ':verificationPrefix': 'VERIFICATION#',
        },
        ExclusiveStartKey: decodeNextToken(
          page?.nextToken,
        ),
        Limit: normalizePageSize(page?.limit),
        ScanIndexForward: false,
      }),
    );

    const items = (result.Items ?? []).map((item) =>
      toVerificationRecord(
        item as VerificationItem,
      ),
    );

    return {
      items,
      nextToken: encodeNextToken(
        result.LastEvaluatedKey,
      ),
    };
  }

  public async listByWorkflow(
    tenantId: string,
    workflowId: string,
    page?: PageRequest,
  ): Promise<PageResult<VerificationRecord>> {
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
      toVerificationRecord(
        item as VerificationItem,
      ),
    );

    return {
      items,
      nextToken: encodeNextToken(
        result.LastEvaluatedKey,
      ),
    };
  }
}