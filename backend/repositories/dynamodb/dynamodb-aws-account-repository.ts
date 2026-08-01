import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  AWS_ACCOUNT_LOCK_SORT_KEY,
  AWS_ACCOUNT_SK_PREFIX,
  awsAccountGlobalIndexPartitionKey,
  awsAccountGlobalIndexSortKey,
  awsAccountLockPartitionKey,
  awsAccountSortKey,
  awsAccountStatusIndexPartitionKey,
  awsAccountStatusIndexSortKey,
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  RepositoryNotFoundError,
  isConditionalCheckFailure,
  tenantPartitionKey,
} from '../../database';

import {
  decodeScopedNextToken,
  encodeScopedNextToken,
} from '../../persistence/scoped-pagination-token';
import { AWS_ACCOUNT_PAGINATION_SCOPES } from '../../persistence/aws-account-pagination-scopes';

import type {
  AwsAccountRepository,
  AwsAccountTransitionFields,
  CreateAwsAccountInput,
  PageRequest,
  PageResult,
  UpdateAwsAccountPatch,
  UpdateOptions,
} from '../contracts';

import { normalizePageSize } from '../contracts/repository-types';

import type { AwsAccountRecord, AwsAccountStatus } from '../models';

import {
  validateAwsAccountId,
  validateAwsAccountShape,
} from '../models/aws-account-persistence-models';

import {
  validateAwsAccountStatusConsistency,
  validateAwsAccountTransition,
  verificationFieldsForValidationFailure,
  verificationFieldsForValidationStart,
  verificationFieldsForValidationSuccess,
} from '../../services/aws-account-lifecycle';

import { BaseDynamoDbRepository } from './base-dynamodb-repository';

interface AwsAccountItem extends AwsAccountRecord {
  pk: string;
  sk: string;
  entityType: 'AWS_ACCOUNT';
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
}

interface AwsAccountLockItem {
  pk: string;
  sk: string;
  entityType: 'AWS_ACCOUNT_LOCK';
  accountId: string;
  tenantId: string;
}

function toAwsAccountRecord(item: AwsAccountItem): AwsAccountRecord {
  return validateAwsAccountShape({
    accountId: item.accountId,
    tenantId: item.tenantId,
    roleArn: item.roleArn,
    externalId: item.externalId,
    region: item.region,
    status: item.status,
    verificationStatus: item.verificationStatus,
    lastValidated: item.lastValidated,
    metadata: item.metadata,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
}

function buildGsiKeys(record: AwsAccountRecord): Pick<
  AwsAccountItem,
  'gsi1pk' | 'gsi1sk' | 'gsi2pk' | 'gsi2sk'
> {
  return {
    gsi1pk: awsAccountGlobalIndexPartitionKey(record.accountId),
    gsi1sk: awsAccountGlobalIndexSortKey(record.tenantId),
    gsi2pk: awsAccountStatusIndexPartitionKey(record.tenantId, record.status),
    gsi2sk: awsAccountStatusIndexSortKey(record.updatedAt, record.accountId),
  };
}

function transitionVerificationPatch(
  existing: AwsAccountRecord,
  nextStatus: AwsAccountStatus,
  fields?: AwsAccountTransitionFields,
): AwsAccountTransitionFields {
  if (fields?.verificationStatus !== undefined) {
    return fields;
  }

  if (nextStatus === 'VALIDATING') {
    return { ...fields, ...verificationFieldsForValidationStart() };
  }

  if (nextStatus === 'VERIFIED') {
    return {
      ...fields,
      ...verificationFieldsForValidationSuccess(new Date().toISOString()),
    };
  }

  if (nextStatus === 'PENDING' && existing.status === 'VALIDATING') {
    return {
      ...fields,
      ...verificationFieldsForValidationFailure(new Date().toISOString()),
    };
  }

  return fields ?? {};
}

export class DynamoDbAwsAccountRepository
  extends BaseDynamoDbRepository
  implements AwsAccountRepository
{
  public constructor(
    client: DynamoDBDocumentClient,
    tableName: string,
  ) {
    super(client, tableName);
  }

  public async create(
    input: CreateAwsAccountInput,
  ): Promise<AwsAccountRecord> {
    validateAwsAccountShape(input);
    validateAwsAccountStatusConsistency({
      status: input.status,
      verificationStatus: input.verificationStatus,
      lastValidated: input.lastValidated,
    });

    const now = new Date().toISOString();
    const record: AwsAccountRecord = {
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const item: AwsAccountItem = {
      pk: tenantPartitionKey(record.tenantId),
      sk: awsAccountSortKey(record.accountId),
      entityType: 'AWS_ACCOUNT',
      ...buildGsiKeys(record),
      ...record,
    };

    const lockItem: AwsAccountLockItem = {
      pk: awsAccountLockPartitionKey(record.accountId),
      sk: AWS_ACCOUNT_LOCK_SORT_KEY,
      entityType: 'AWS_ACCOUNT_LOCK',
      accountId: record.accountId,
      tenantId: record.tenantId,
    };

    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: item,
                ConditionExpression:
                  'attribute_not_exists(pk) AND attribute_not_exists(sk)',
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: lockItem,
                ConditionExpression: 'attribute_not_exists(pk)',
              },
            },
          ],
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryAlreadyExistsError(
          `AWS account ${record.accountId} is already registered.`,
        );
      }

      throw error;
    }

    return record;
  }

  public async getById(
    tenantId: string,
    accountId: string,
  ): Promise<AwsAccountRecord | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: tenantPartitionKey(tenantId),
          sk: awsAccountSortKey(accountId),
        },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return undefined;
    }

    return toAwsAccountRecord(result.Item as AwsAccountItem);
  }

  public async getByAccountId(
    accountId: string,
  ): Promise<AwsAccountRecord | undefined> {
    const normalizedAccountId = validateAwsAccountId(accountId);

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: '#gsi1pk = :gsi1pk',
        ExpressionAttributeNames: {
          '#gsi1pk': 'gsi1pk',
        },
        ExpressionAttributeValues: {
          ':gsi1pk': awsAccountGlobalIndexPartitionKey(normalizedAccountId),
        },
        Limit: 2,
      }),
    );

    const items = (result.Items ?? []) as AwsAccountItem[];
    if (items.length === 0) {
      return undefined;
    }

    if (items.length > 1) {
      throw new Error(
        `Integrity error: AWS account ${normalizedAccountId} is registered to multiple tenants.`,
      );
    }

    return toAwsAccountRecord(items[0]!);
  }

  public async update(
    tenantId: string,
    accountId: string,
    patch: UpdateAwsAccountPatch,
    options: UpdateOptions,
  ): Promise<AwsAccountRecord> {
    const existing = await this.getById(tenantId, accountId);
    if (!existing) {
      throw new RepositoryNotFoundError(
        `AWS account ${accountId} was not found.`,
      );
    }

    const merged: AwsAccountRecord = {
      ...existing,
      ...patch,
      accountId: existing.accountId,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
    };

    validateAwsAccountShape(merged);
    validateAwsAccountStatusConsistency({
      status: merged.status,
      verificationStatus: merged.verificationStatus,
      lastValidated: merged.lastValidated,
    });

    const storageChanges: Record<string, unknown> = { ...patch };

    if (patch.status !== undefined) {
      storageChanges.gsi2pk = awsAccountStatusIndexPartitionKey(
        tenantId,
        patch.status,
      );
    }

    const expression = this.buildVersionedUpdateExpression(
      storageChanges,
      options.expectedVersion,
    );

    expression.updateExpression += ', #gsi2sk = :gsi2skValue';
    expression.expressionAttributeNames['#gsi2sk'] = 'gsi2sk';
    expression.expressionAttributeValues[':gsi2skValue'] =
      awsAccountStatusIndexSortKey(
        expression.expressionAttributeValues[':updatedAt'] as string,
        accountId,
      );

    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: tenantPartitionKey(tenantId),
            sk: awsAccountSortKey(accountId),
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
          `AWS account ${accountId} was not found.`,
        );
      }

      return toAwsAccountRecord(result.Attributes as AwsAccountItem);
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError(
          `AWS account ${accountId} could not be updated because its version changed or it no longer exists.`,
        );
      }

      throw error;
    }
  }

  public async transitionStatus(
    tenantId: string,
    accountId: string,
    nextStatus: AwsAccountStatus,
    options: UpdateOptions,
    fields?: AwsAccountTransitionFields,
  ): Promise<AwsAccountRecord> {
    const existing = await this.getById(tenantId, accountId);
    if (!existing) {
      throw new RepositoryNotFoundError(
        `AWS account ${accountId} was not found.`,
      );
    }

    validateAwsAccountTransition(existing.status, nextStatus);

    const verificationPatch = transitionVerificationPatch(
      existing,
      nextStatus,
      fields,
    );

    const mergedPreview: AwsAccountRecord = {
      ...existing,
      ...verificationPatch,
      status: nextStatus,
    };

    validateAwsAccountStatusConsistency({
      status: mergedPreview.status,
      verificationStatus: mergedPreview.verificationStatus,
      lastValidated: mergedPreview.lastValidated,
    });

    return this.update(
      tenantId,
      accountId,
      {
        status: nextStatus,
        ...verificationPatch,
      },
      options,
    );
  }

  public async listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<AwsAccountRecord>> {
    const scope = AWS_ACCOUNT_PAGINATION_SCOPES.tenantList(tenantId);

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression:
          '#pk = :pk AND begins_with(#sk, :accountPrefix)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(tenantId),
          ':accountPrefix': AWS_ACCOUNT_SK_PREFIX,
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
      toAwsAccountRecord(item as AwsAccountItem),
    );

    return {
      items,
      nextToken: encodeScopedNextToken(
        { tenantId, scope },
        result.LastEvaluatedKey,
      ),
    };
  }

  public async listByStatus(
    tenantId: string,
    status: AwsAccountStatus,
    page?: PageRequest,
  ): Promise<PageResult<AwsAccountRecord>> {
    const scope = AWS_ACCOUNT_PAGINATION_SCOPES.statusList(tenantId, status);

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi2',
        KeyConditionExpression: '#gsi2pk = :gsi2pk',
        ExpressionAttributeNames: {
          '#gsi2pk': 'gsi2pk',
        },
        ExpressionAttributeValues: {
          ':gsi2pk': awsAccountStatusIndexPartitionKey(tenantId, status),
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
      toAwsAccountRecord(item as AwsAccountItem),
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
