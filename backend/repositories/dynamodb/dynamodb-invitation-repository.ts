import {
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
  decodeNextToken,
  encodeNextToken,
  invitationSortKey,
  invitationTokenIndexPartitionKey,
  isConditionalCheckFailure,
  INVITATION_TOKEN_INDEX_SORT_KEY,
  tenantPartitionKey,
} from '../../database';

import type {
  CreateInvitationInput,
  InvitationRepository,
  PageRequest,
  PageResult,
  UpdateInvitationInput,
  UpdateOptions,
} from '../contracts';

import { normalizePageSize } from '../contracts/repository-types';

import type { InvitationRecord } from '../models';

import { BaseDynamoDbRepository } from './base-dynamodb-repository';

interface InvitationItem extends InvitationRecord {
  pk: string;
  sk: string;
  entityType: 'INVITATION';
  gsi1pk: string;
  gsi1sk: typeof INVITATION_TOKEN_INDEX_SORT_KEY;
}

function toInvitationRecord(item: InvitationItem): InvitationRecord {
  return {
    tenantId: item.tenantId,
    invitationId: item.invitationId,
    email: item.email,
    role: item.role,
    status: item.status,
    tokenHash: item.tokenHash,
    expiresAtIso: item.expiresAtIso,
    expiresAt: item.expiresAt,
    invitedBy: item.invitedBy,
    acceptedAt: item.acceptedAt,
    acceptedByUserId: item.acceptedByUserId,
    cancelledAt: item.cancelledAt,
    cancelledBy: item.cancelledBy,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/** Raised by markAccepted() when replay is attempted or the token expired. */
export class InvitationNotAcceptableError extends Error {
  constructor(message = 'The invitation can no longer be accepted.') {
    super(message);
    this.name = 'InvitationNotAcceptableError';
  }
}

export class DynamoDbInvitationRepository
  extends BaseDynamoDbRepository
  implements InvitationRepository
{
  public constructor(client: DynamoDBDocumentClient, tableName: string) {
    super(client, tableName);
  }

  public async create(
    input: CreateInvitationInput,
  ): Promise<InvitationRecord> {
    const now = new Date().toISOString();

    const record: InvitationRecord = {
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const item: InvitationItem = {
      pk: tenantPartitionKey(record.tenantId),
      sk: invitationSortKey(record.invitationId),
      entityType: 'INVITATION',
      gsi1pk: invitationTokenIndexPartitionKey(record.tokenHash),
      gsi1sk: INVITATION_TOKEN_INDEX_SORT_KEY,
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
          `Invitation ${record.invitationId} already exists.`,
        );
      }

      throw error;
    }

    return record;
  }

  public async get(
    tenantId: string,
    invitationId: string,
  ): Promise<InvitationRecord | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: tenantPartitionKey(tenantId),
          sk: invitationSortKey(invitationId),
        },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return undefined;
    }

    return toInvitationRecord(result.Item as InvitationItem);
  }

  public async getByTokenHash(
    tokenHash: string,
  ): Promise<InvitationRecord | undefined> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: '#gsi1pk = :gsi1pk',
        ExpressionAttributeNames: {
          '#gsi1pk': 'gsi1pk',
        },
        ExpressionAttributeValues: {
          ':gsi1pk': invitationTokenIndexPartitionKey(tokenHash),
        },
        Limit: 1,
      }),
    );

    const [item] = result.Items ?? [];

    if (!item) {
      return undefined;
    }

    return toInvitationRecord(item as InvitationItem);
  }

  public async update(
    tenantId: string,
    invitationId: string,
    changes: UpdateInvitationInput,
    options: UpdateOptions,
  ): Promise<InvitationRecord> {
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
            sk: invitationSortKey(invitationId),
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
          `Invitation ${invitationId} was not found.`,
        );
      }

      return toInvitationRecord(result.Attributes as InvitationItem);
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError(
          `Invitation ${invitationId} could not be updated because its version changed or it no longer exists.`,
        );
      }

      throw error;
    }
  }

  /**
   * Atomically consumes a PENDING, non-expired invitation. The condition
   * expression is the single source of truth for replay prevention: two
   * concurrent accept attempts race on the same conditional write, and only
   * one can ever transition status PENDING -> ACCEPTED.
   */
  public async markAccepted(
    tenantId: string,
    invitationId: string,
    input: { acceptedByUserId: string; acceptedAt: string; nowIso: string },
  ): Promise<InvitationRecord> {
    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: tenantPartitionKey(tenantId),
            sk: invitationSortKey(invitationId),
          },
          UpdateExpression:
            'SET #status = :accepted, #acceptedAt = :acceptedAt, #acceptedBy = :acceptedBy, #updatedAt = :updatedAt, #version = #version + :one',
          ConditionExpression:
            'attribute_exists(pk) AND #status = :pending AND #expiresAtIso > :now',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#acceptedAt': 'acceptedAt',
            '#acceptedBy': 'acceptedByUserId',
            '#updatedAt': 'updatedAt',
            '#version': 'version',
            '#expiresAtIso': 'expiresAtIso',
          },
          ExpressionAttributeValues: {
            ':accepted': 'ACCEPTED',
            ':pending': 'PENDING',
            ':acceptedAt': input.acceptedAt,
            ':acceptedBy': input.acceptedByUserId,
            ':updatedAt': input.acceptedAt,
            ':one': 1,
            ':now': input.nowIso,
          },
          ReturnValues: 'ALL_NEW',
        }),
      );

      if (!result.Attributes) {
        throw new RepositoryNotFoundError(
          `Invitation ${invitationId} was not found.`,
        );
      }

      return toInvitationRecord(result.Attributes as InvitationItem);
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new InvitationNotAcceptableError(
          `Invitation ${invitationId} is not pending or has expired; it cannot be accepted (possible replay).`,
        );
      }

      throw error;
    }
  }

  public async listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<InvitationRecord>> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :invitePrefix)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(tenantId),
          ':invitePrefix': 'INVITE#',
        },
        ExclusiveStartKey: decodeNextToken(page?.nextToken),
        Limit: normalizePageSize(page?.limit),
      }),
    );

    const items = (result.Items ?? []).map((item) =>
      toInvitationRecord(item as InvitationItem),
    );

    return {
      items,
      nextToken: encodeNextToken(result.LastEvaluatedKey),
    };
  }
}
