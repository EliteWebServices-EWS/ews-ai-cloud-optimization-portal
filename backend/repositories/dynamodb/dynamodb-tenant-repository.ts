import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  RepositoryNotFoundError,
  decodeNextToken,
  encodeNextToken,
  isConditionalCheckFailure,
  normalizeTenantSlug,
  tenantCreatedAtSortKey,
  tenantOwnerIndexPartitionKey,
  tenantRegistryPartitionKey,
  tenantSlugIndexPartitionKey,
  tenantSlugReservationPartitionKey,
  tenantStatusIndexPartitionKey,
  TENANT_REGISTRY_INDEX_PARTITION_KEY,
  TENANT_REGISTRY_SORT_KEY,
  TENANT_SLUG_RESERVATION_SORT_KEY,
} from '../../database';

import {
  validateTenantTransition,
} from '../../services/tenant-lifecycle';

import type {
  CreateTenantInput,
  PageRequest,
  PageResult,
  TenantRepository,
  UpdateOptions,
  UpdateTenantInput,
} from '../contracts';

import {
  normalizePageSize,
} from '../contracts/repository-types';

import type {
  TenantRecord,
  TenantStatus,
} from '../models';

import {
  BaseDynamoDbRepository,
} from './base-dynamodb-repository';

interface TenantItem extends TenantRecord {
  pk: string;
  sk: string;
  entityType: 'TENANT';

  gsi1pk: string;
  gsi1sk: string;

  gsi2pk: string;
  gsi2sk: string;

  gsi3pk: string;
  gsi3sk: string;

  gsi4pk: string;
  gsi4sk: string;
}

interface TenantSlugReservationItem {
  pk: string;
  sk: string;
  entityType: 'TENANT_SLUG_RESERVATION';
  tenantId: string;
  slug: string;
  createdAt: string;
}

function toTenantRecord(
  item: TenantItem,
): TenantRecord {
  return {
    tenantId: item.tenantId,
    organizationName: item.organizationName,
    displayName: item.displayName,
    slug: item.slug,
    ownerUserId: item.ownerUserId,
    primaryContact: item.primaryContact,
    status: item.status,
    region: item.region,
    subscriptionPlan: item.subscriptionPlan,
    metadata: item.metadata,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function isTransactionCanceled(
  error: unknown,
): boolean {
  return (
    error instanceof Error &&
    error.name === 'TransactionCanceledException'
  );
}

export class DynamoDbTenantRepository
  extends BaseDynamoDbRepository
  implements TenantRepository
{
  public constructor(
    client: DynamoDBDocumentClient,
    tableName: string,
  ) {
    super(client, tableName);
  }

  public async create(
    input: CreateTenantInput,
  ): Promise<TenantRecord> {
    const now = new Date().toISOString();
    const normalizedSlug =
      normalizeTenantSlug(input.slug);

    const record: TenantRecord = {
      ...input,
      slug: normalizedSlug,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const tenantItem: TenantItem = {
      pk: tenantRegistryPartitionKey(
        record.tenantId,
      ),
      sk: TENANT_REGISTRY_SORT_KEY,
      entityType: 'TENANT',

      gsi1pk: tenantSlugIndexPartitionKey(
        record.slug,
      ),
      gsi1sk: tenantRegistryPartitionKey(
        record.tenantId,
      ),

      gsi2pk: tenantOwnerIndexPartitionKey(
        record.ownerUserId,
      ),
      gsi2sk: tenantCreatedAtSortKey(
        record.createdAt,
        record.tenantId,
      ),

      gsi3pk: tenantStatusIndexPartitionKey(
        record.status,
      ),
      gsi3sk: tenantCreatedAtSortKey(
        record.createdAt,
        record.tenantId,
      ),

      gsi4pk: TENANT_REGISTRY_INDEX_PARTITION_KEY,
      gsi4sk: tenantCreatedAtSortKey(
        record.createdAt,
        record.tenantId,
      ),

      ...record,
    };

    const slugReservation:
      TenantSlugReservationItem = {
        pk: tenantSlugReservationPartitionKey(
          record.slug,
        ),
        sk: TENANT_SLUG_RESERVATION_SORT_KEY,
        entityType: 'TENANT_SLUG_RESERVATION',
        tenantId: record.tenantId,
        slug: record.slug,
        createdAt: now,
      };

    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: tenantItem,
                ConditionExpression:
                  'attribute_not_exists(pk) AND attribute_not_exists(sk)',
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: slugReservation,
                ConditionExpression:
                  'attribute_not_exists(pk) AND attribute_not_exists(sk)',
              },
            },
          ],
        }),
      );
    } catch (error) {
      if (
        isConditionalCheckFailure(error) ||
        isTransactionCanceled(error)
      ) {
        throw new RepositoryAlreadyExistsError(
          `Tenant ${record.tenantId} or slug ${record.slug} already exists.`,
        );
      }

      throw error;
    }

    return record;
  }

  public async getById(
    tenantId: string,
  ): Promise<TenantRecord | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: tenantRegistryPartitionKey(
            tenantId,
          ),
          sk: TENANT_REGISTRY_SORT_KEY,
        },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return undefined;
    }

    return toTenantRecord(
      result.Item as TenantItem,
    );
  }

  public async getBySlug(
    slug: string,
  ): Promise<TenantRecord | undefined> {
    const normalizedSlug =
      normalizeTenantSlug(slug);

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
            tenantSlugIndexPartitionKey(
              normalizedSlug,
            ),
        },
        Limit: 1,
      }),
    );

    const item = result.Items?.[0];

    if (!item) {
      return undefined;
    }

    return toTenantRecord(item as TenantItem);
  }

  public async update(
    tenantId: string,
    changes: UpdateTenantInput,
    options: UpdateOptions,
  ): Promise<TenantRecord> {
    const storageChanges:
      Record<string, unknown> = {
        ...changes,
      };

    if (changes.ownerUserId !== undefined) {
      storageChanges.gsi2pk =
        tenantOwnerIndexPartitionKey(
          changes.ownerUserId,
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
            pk: tenantRegistryPartitionKey(
              tenantId,
            ),
            sk: TENANT_REGISTRY_SORT_KEY,
          },
          UpdateExpression:
            expression.updateExpression,
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
          `Tenant ${tenantId} was not found.`,
        );
      }

      return toTenantRecord(
        result.Attributes as TenantItem,
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError(
          `Tenant ${tenantId} could not be updated because its version changed or it no longer exists.`,
        );
      }

      throw error;
    }
  }

  public async transitionStatus(
    tenantId: string,
    nextStatus: TenantStatus,
    options: UpdateOptions,
  ): Promise<TenantRecord> {
    const currentTenant =
      await this.getById(tenantId);

    if (!currentTenant) {
      throw new RepositoryNotFoundError(
        `Tenant ${tenantId} was not found.`,
      );
    }

    validateTenantTransition(
      currentTenant.status,
      nextStatus,
    );

    const expression =
      this.buildVersionedUpdateExpression(
        {
          status: nextStatus,
          gsi3pk:
            tenantStatusIndexPartitionKey(
              nextStatus,
            ),
        },
        options.expectedVersion,
      );

    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: tenantRegistryPartitionKey(
              tenantId,
            ),
            sk: TENANT_REGISTRY_SORT_KEY,
          },
          UpdateExpression:
            expression.updateExpression,
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
          `Tenant ${tenantId} was not found.`,
        );
      }

      return toTenantRecord(
        result.Attributes as TenantItem,
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError(
          `Tenant ${tenantId} could not change status because its version changed or it no longer exists.`,
        );
      }

      throw error;
    }
  }

  public async listByOwner(
    ownerUserId: string,
    page?: PageRequest,
  ): Promise<PageResult<TenantRecord>> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi2',
        KeyConditionExpression:
          '#gsi2pk = :gsi2pk',
        ExpressionAttributeNames: {
          '#gsi2pk': 'gsi2pk',
        },
        ExpressionAttributeValues: {
          ':gsi2pk':
            tenantOwnerIndexPartitionKey(
              ownerUserId,
            ),
        },
        ExclusiveStartKey: decodeNextToken(
          page?.nextToken,
        ),
        Limit: normalizePageSize(page?.limit),
        ScanIndexForward: false,
      }),
    );

    const items = (result.Items ?? []).map(
      (item) =>
        toTenantRecord(item as TenantItem),
    );

    return {
      items,
      nextToken: encodeNextToken(
        result.LastEvaluatedKey,
      ),
    };
  }

  public async listByStatus(
    status: TenantStatus,
    page?: PageRequest,
  ): Promise<PageResult<TenantRecord>> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi3',
        KeyConditionExpression:
          '#gsi3pk = :gsi3pk',
        ExpressionAttributeNames: {
          '#gsi3pk': 'gsi3pk',
        },
        ExpressionAttributeValues: {
          ':gsi3pk':
            tenantStatusIndexPartitionKey(
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

    const items = (result.Items ?? []).map(
      (item) =>
        toTenantRecord(item as TenantItem),
    );

    return {
      items,
      nextToken: encodeNextToken(
        result.LastEvaluatedKey,
      ),
    };
  }

  public async listAll(
    page?: PageRequest,
  ): Promise<PageResult<TenantRecord>> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi4',
        KeyConditionExpression:
          '#gsi4pk = :gsi4pk',
        ExpressionAttributeNames: {
          '#gsi4pk': 'gsi4pk',
        },
        ExpressionAttributeValues: {
          ':gsi4pk':
            TENANT_REGISTRY_INDEX_PARTITION_KEY,
        },
        ExclusiveStartKey: decodeNextToken(
          page?.nextToken,
        ),
        Limit: normalizePageSize(page?.limit),
        ScanIndexForward: false,
      }),
    );

    const items = (result.Items ?? []).map(
      (item) =>
        toTenantRecord(item as TenantItem),
    );

    return {
      items,
      nextToken: encodeNextToken(
        result.LastEvaluatedKey,
      ),
    };
  }
}