import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  OWNERSHIP_SORT_KEY,
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  isConditionalCheckFailure,
  ownershipPartitionKey,
} from '../../database';

import type {
  CreateOwnershipInput,
  OwnershipRepository,
} from '../contracts';

import type {
  OwnershipRecord,
  OwnershipResourceType,
} from '../models';

import { BaseDynamoDbRepository } from './base-dynamodb-repository';

interface OwnershipItem extends OwnershipRecord {
  pk: string;
  sk: typeof OWNERSHIP_SORT_KEY;
  entityType: 'OWNERSHIP';
}

function toOwnershipRecord(
  item: OwnershipItem,
): OwnershipRecord {
  return {
    resourceType: item.resourceType,
    resourceId: item.resourceId,
    ownerTenantId: item.ownerTenantId,
    expiresAt: item.expiresAt,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export class DynamoDbOwnershipRepository
  extends BaseDynamoDbRepository
  implements OwnershipRepository
{
  public constructor(
    client: DynamoDBDocumentClient,
    tableName: string,
  ) {
    super(client, tableName);
  }

  public async create(
    input: CreateOwnershipInput,
  ): Promise<OwnershipRecord> {
    const now = new Date().toISOString();

    const record: OwnershipRecord = {
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const item: OwnershipItem = {
      pk: ownershipPartitionKey(
        record.resourceType,
        record.resourceId,
      ),
      sk: OWNERSHIP_SORT_KEY,
      entityType: 'OWNERSHIP',
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
          `Ownership record for ${record.resourceType} ${record.resourceId} already exists.`,
        );
      }

      throw error;
    }

    return record;
  }

  public async get(
    resourceType: OwnershipResourceType,
    resourceId: string,
  ): Promise<OwnershipRecord | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: ownershipPartitionKey(
            resourceType,
            resourceId,
          ),
          sk: OWNERSHIP_SORT_KEY,
        },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return undefined;
    }

    return toOwnershipRecord(
      result.Item as OwnershipItem,
    );
  }

  public async delete(
    resourceType: OwnershipResourceType,
    resourceId: string,
    expectedVersion?: number,
  ): Promise<void> {
    if (
      expectedVersion !== undefined &&
      (!Number.isInteger(expectedVersion) ||
        expectedVersion < 1)
    ) {
      throw new Error(
        'expectedVersion must be a positive integer.',
      );
    }

    const expressionAttributeNames:
      | Record<string, string>
      | undefined =
      expectedVersion !== undefined
        ? {
            '#version': 'version',
          }
        : undefined;

    const expressionAttributeValues:
      | Record<string, unknown>
      | undefined =
      expectedVersion !== undefined
        ? {
            ':expectedVersion': expectedVersion,
          }
        : undefined;

    const conditionExpression =
      expectedVersion !== undefined
        ? 'attribute_exists(pk) AND #version = :expectedVersion'
        : 'attribute_exists(pk)';

    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            pk: ownershipPartitionKey(
              resourceType,
              resourceId,
            ),
            sk: OWNERSHIP_SORT_KEY,
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
          `Ownership record for ${resourceType} ${resourceId} could not be deleted because it does not exist or its version changed.`,
        );
      }

      throw error;
    }
  }
}