import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  RepositoryNotFoundError,
  TenantOwnerBootstrapConflictError,
  decodeNextToken,
  encodeNextToken,
  isConditionalCheckFailure,
  memberIdIndexPartitionKey,
  membershipSortKey,
  MEMBER_ID_INDEX_SORT_KEY,
  TENANT_OWNER_BOOTSTRAP_SORT_KEY,
  tenantPartitionKey,
  userMembershipIndexPartitionKey,
  userMembershipIndexSortKey,
} from '../../database';

import type {
  BootstrapFirstOwnerInput,
  CreateMembershipInput,
  MembershipRepository,
  PageRequest,
  PageResult,
  UpdateMembershipInput,
  UpdateOptions,
} from '../contracts';

import { normalizePageSize } from '../contracts/repository-types';

import type { MembershipRecord } from '../models';

import { BaseDynamoDbRepository } from './base-dynamodb-repository';

interface MembershipItem extends MembershipRecord {
  pk: string;
  sk: string;
  entityType: 'MEMBERSHIP';
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: typeof MEMBER_ID_INDEX_SORT_KEY;
}

interface TenantOwnerBootstrapItem {
  pk: string;
  sk: typeof TENANT_OWNER_BOOTSTRAP_SORT_KEY;
  entityType: 'TENANT_OWNER_BOOTSTRAP';
  tenantId: string;
  bootstrappedByUserId: string;
  memberId: string;
  bootstrappedAt: string;
}

function toMembershipRecord(item: MembershipItem): MembershipRecord {
  return {
    tenantId: item.tenantId,
    memberId: item.memberId,
    userId: item.userId,
    role: item.role,
    status: item.status,
    joinedAt: item.joinedAt,
    invitedBy: item.invitedBy,
    invitationId: item.invitationId,
    statusChangedAt: item.statusChangedAt,
    statusChangedBy: item.statusChangedBy,
    expiresAt: item.expiresAt,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export class DynamoDbMembershipRepository
  extends BaseDynamoDbRepository
  implements MembershipRepository
{
  public constructor(client: DynamoDBDocumentClient, tableName: string) {
    super(client, tableName);
  }

  public async create(
    input: CreateMembershipInput,
  ): Promise<MembershipRecord> {
    const now = new Date().toISOString();

    const record: MembershipRecord = {
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const item: MembershipItem = {
      pk: tenantPartitionKey(record.tenantId),
      sk: membershipSortKey(record.userId),
      entityType: 'MEMBERSHIP',
      gsi1pk: userMembershipIndexPartitionKey(record.userId),
      gsi1sk: userMembershipIndexSortKey(record.tenantId, record.userId),
      gsi2pk: memberIdIndexPartitionKey(record.memberId),
      gsi2sk: MEMBER_ID_INDEX_SORT_KEY,
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
          `Membership for user ${record.userId} in tenant ${record.tenantId} already exists.`,
        );
      }

      throw error;
    }

    return record;
  }

  public async tenantHasAnyMembershipRecords(
    tenantId: string,
  ): Promise<boolean> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression:
          '#pk = :pk AND begins_with(#sk, :memberPrefix)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(tenantId),
          ':memberPrefix': 'MEMBER#',
        },
        Limit: 1,
        ConsistentRead: true,
      }),
    );

    return (result.Items?.length ?? 0) > 0;
  }

  public async bootstrapFirstOwner(
    input: BootstrapFirstOwnerInput,
  ): Promise<MembershipRecord> {
    if (await this.tenantHasAnyMembershipRecords(input.tenantId)) {
      throw new TenantOwnerBootstrapConflictError();
    }

    const now = new Date().toISOString();

    const record: MembershipRecord = {
      tenantId: input.tenantId,
      memberId: input.memberId,
      userId: input.userId,
      role: 'tenant_owner',
      status: 'ACTIVE',
      joinedAt: now,
      statusChangedAt: now,
      statusChangedBy: input.userId,
      invitedBy: input.userId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const membershipItem: MembershipItem = {
      pk: tenantPartitionKey(record.tenantId),
      sk: membershipSortKey(record.userId),
      entityType: 'MEMBERSHIP',
      gsi1pk: userMembershipIndexPartitionKey(record.userId),
      gsi1sk: userMembershipIndexSortKey(record.tenantId, record.userId),
      gsi2pk: memberIdIndexPartitionKey(record.memberId),
      gsi2sk: MEMBER_ID_INDEX_SORT_KEY,
      ...record,
    };

    const bootstrapMarker: TenantOwnerBootstrapItem = {
      pk: tenantPartitionKey(input.tenantId),
      sk: TENANT_OWNER_BOOTSTRAP_SORT_KEY,
      entityType: 'TENANT_OWNER_BOOTSTRAP',
      tenantId: input.tenantId,
      bootstrappedByUserId: input.userId,
      memberId: input.memberId,
      bootstrappedAt: now,
    };

    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: bootstrapMarker,
                ConditionExpression:
                  'attribute_not_exists(pk) AND attribute_not_exists(sk)',
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: membershipItem,
                ConditionExpression:
                  'attribute_not_exists(pk) AND attribute_not_exists(sk)',
              },
            },
          ],
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new TenantOwnerBootstrapConflictError();
      }

      throw error;
    }

    return record;
  }

  public async get(
    tenantId: string,
    userId: string,
  ): Promise<MembershipRecord | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: tenantPartitionKey(tenantId),
          sk: membershipSortKey(userId),
        },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return undefined;
    }

    return toMembershipRecord(result.Item as MembershipItem);
  }

  public async getByMemberId(
    memberId: string,
  ): Promise<MembershipRecord | undefined> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi2',
        KeyConditionExpression: '#gsi2pk = :gsi2pk',
        ExpressionAttributeNames: {
          '#gsi2pk': 'gsi2pk',
        },
        ExpressionAttributeValues: {
          ':gsi2pk': memberIdIndexPartitionKey(memberId),
        },
        Limit: 1,
      }),
    );

    const [item] = result.Items ?? [];

    if (!item) {
      return undefined;
    }

    return toMembershipRecord(item as MembershipItem);
  }

  public async update(
    tenantId: string,
    userId: string,
    changes: UpdateMembershipInput,
    options: UpdateOptions,
  ): Promise<MembershipRecord> {
    const expression = this.buildVersionedUpdateExpression(
      { ...changes },
      options.expectedVersion,
    );

    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: tenantPartitionKey(tenantId),
            sk: membershipSortKey(userId),
          },
          UpdateExpression: expression.updateExpression,
          ConditionExpression:
            'attribute_exists(pk) AND #version = :expectedVersion',
          ExpressionAttributeNames: expression.expressionAttributeNames,
          ExpressionAttributeValues: expression.expressionAttributeValues,
          ReturnValues: 'ALL_NEW',
        }),
      );

      if (!result.Attributes) {
        throw new RepositoryNotFoundError(
          `Membership for user ${userId} in tenant ${tenantId} was not found.`,
        );
      }

      return toMembershipRecord(result.Attributes as MembershipItem);
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError(
          `Membership for user ${userId} in tenant ${tenantId} could not be updated because its version changed or it no longer exists.`,
        );
      }

      throw error;
    }
  }

  public async delete(
    tenantId: string,
    userId: string,
    options?: UpdateOptions,
  ): Promise<void> {
    const expressionAttributeNames: Record<string, string> | undefined =
      options ? { '#version': 'version' } : undefined;

    const expressionAttributeValues: Record<string, unknown> | undefined =
      options ? { ':expectedVersion': options.expectedVersion } : undefined;

    const conditionExpression = options
      ? 'attribute_exists(pk) AND #version = :expectedVersion'
      : 'attribute_exists(pk)';

    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            pk: tenantPartitionKey(tenantId),
            sk: membershipSortKey(userId),
          },
          ConditionExpression: conditionExpression,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError(
          `Membership for user ${userId} in tenant ${tenantId} could not be deleted because it does not exist or its version changed.`,
        );
      }

      throw error;
    }
  }

  public async listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<MembershipRecord>> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :memberPrefix)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(tenantId),
          ':memberPrefix': 'MEMBER#',
        },
        ExclusiveStartKey: decodeNextToken(page?.nextToken),
        Limit: normalizePageSize(page?.limit),
      }),
    );

    const items = (result.Items ?? []).map((item) =>
      toMembershipRecord(item as MembershipItem),
    );

    return {
      items,
      nextToken: encodeNextToken(result.LastEvaluatedKey),
    };
  }

  public async listByUser(
    userId: string,
    page?: PageRequest,
  ): Promise<PageResult<MembershipRecord>> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: '#gsi1pk = :gsi1pk',
        ExpressionAttributeNames: {
          '#gsi1pk': 'gsi1pk',
        },
        ExpressionAttributeValues: {
          ':gsi1pk': userMembershipIndexPartitionKey(userId),
        },
        ExclusiveStartKey: decodeNextToken(page?.nextToken),
        Limit: normalizePageSize(page?.limit),
      }),
    );

    const items = (result.Items ?? []).map((item) =>
      toMembershipRecord(item as MembershipItem),
    );

    return {
      items,
      nextToken: encodeNextToken(result.LastEvaluatedKey),
    };
  }
}
