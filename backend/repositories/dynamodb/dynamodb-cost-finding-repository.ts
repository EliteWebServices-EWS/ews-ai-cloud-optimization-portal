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
  accountResourceIndexPartitionKey,
  costFindingSortKey,
  createdAtIndexSortKey,
  decodeNextToken,
  encodeNextToken,
  isConditionalCheckFailure,
  tenantPartitionKey,
} from '../../database';

import type {
  CostFindingRepository,
  CreateCostFindingInput,
  PageRequest,
  PageResult,
  UpdateCostFindingInput,
  UpdateOptions,
} from '../contracts';
import { normalizePageSize } from '../contracts/repository-types';

import type { CostFindingRecord } from '../models';

import { BaseDynamoDbRepository } from './base-dynamodb-repository';

interface CostFindingItem extends CostFindingRecord {
  pk: string;
  sk: string;
  entityType: 'COST_FINDING';
  gsi1pk: string;
  gsi1sk: string;
}

function toCostFindingRecord(item: CostFindingItem): CostFindingRecord {
  return {
    tenantId: item.tenantId,
    findingId: item.findingId,
    analysisId: item.analysisId,
    accountId: item.accountId,
    instanceId: item.instanceId,
    instanceType: item.instanceType,
    region: item.region,
    findingType: item.findingType,
    severity: item.severity,
    status: item.status,
    reason: item.reason,
    tags: item.tags,
    monthlySavings: item.monthlySavings,
    currency: item.currency,
    financialImpact: item.financialImpact,
    confidence: item.confidence,
    metadata: item.metadata,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export class DynamoDbCostFindingRepository
  extends BaseDynamoDbRepository
  implements CostFindingRepository
{
  public constructor(client: DynamoDBDocumentClient, tableName: string) {
    super(client, tableName);
  }

  public async create(input: CreateCostFindingInput): Promise<CostFindingRecord> {
    const now = new Date().toISOString();

    const record: CostFindingRecord = {
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const item: CostFindingItem = {
      pk: tenantPartitionKey(record.tenantId),
      sk: costFindingSortKey(record.findingId),
      entityType: 'COST_FINDING',
      gsi1pk: accountResourceIndexPartitionKey(record.tenantId, record.accountId),
      gsi1sk: createdAtIndexSortKey(record.createdAt, 'COST_FINDING', record.findingId),
      ...record,
    };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryAlreadyExistsError(
          `Cost finding ${record.findingId} already exists.`,
        );
      }
      throw error;
    }

    return record;
  }

  public async get(
    tenantId: string,
    findingId: string,
  ): Promise<CostFindingRecord | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: tenantPartitionKey(tenantId),
          sk: costFindingSortKey(findingId),
        },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return undefined;
    }

    return toCostFindingRecord(result.Item as CostFindingItem);
  }

  public async update(
    tenantId: string,
    findingId: string,
    changes: UpdateCostFindingInput,
    options: UpdateOptions,
  ): Promise<CostFindingRecord> {
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
            sk: costFindingSortKey(findingId),
          },
          UpdateExpression: expression.updateExpression,
          ConditionExpression: 'attribute_exists(pk) AND #version = :expectedVersion',
          ExpressionAttributeNames: expression.expressionAttributeNames,
          ExpressionAttributeValues: expression.expressionAttributeValues,
          ReturnValues: 'ALL_NEW',
        }),
      );

      if (!result.Attributes) {
        throw new RepositoryNotFoundError(`Cost finding ${findingId} was not found.`);
      }

      return toCostFindingRecord(result.Attributes as CostFindingItem);
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError(
          `Cost finding ${findingId} could not be updated because its version changed or it no longer exists.`,
        );
      }
      throw error;
    }
  }

  public async listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<CostFindingRecord>> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(tenantId),
          ':prefix': 'COST_FINDING#',
        },
        ExclusiveStartKey: decodeNextToken(page?.nextToken),
        Limit: normalizePageSize(page?.limit),
        ScanIndexForward: false,
      }),
    );

    const items = (result.Items ?? []).map((item) =>
      toCostFindingRecord(item as CostFindingItem),
    );

    return { items, nextToken: encodeNextToken(result.LastEvaluatedKey) };
  }

  public async listByAccount(
    tenantId: string,
    accountId: string,
    page?: PageRequest,
  ): Promise<PageResult<CostFindingRecord>> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: '#gsi1pk = :gsi1pk',
        ExpressionAttributeNames: { '#gsi1pk': 'gsi1pk' },
        ExpressionAttributeValues: {
          ':gsi1pk': accountResourceIndexPartitionKey(tenantId, accountId),
        },
        ExclusiveStartKey: decodeNextToken(page?.nextToken),
        Limit: normalizePageSize(page?.limit),
        ScanIndexForward: false,
      }),
    );

    const items = (result.Items ?? []).map((item) =>
      toCostFindingRecord(item as CostFindingItem),
    );

    return { items, nextToken: encodeNextToken(result.LastEvaluatedKey) };
  }

  public async listByAnalysis(
    tenantId: string,
    analysisId: string,
  ): Promise<CostFindingRecord[]> {
    // Bounded by instances-per-account-per-run; a single tenant-scoped query
    // page is sufficient (mirrors the report engine's platform-scale tradeoff).
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        FilterExpression: '#analysisId = :analysisId',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
          '#analysisId': 'analysisId',
        },
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(tenantId),
          ':prefix': 'COST_FINDING#',
          ':analysisId': analysisId,
        },
        ScanIndexForward: false,
      }),
    );

    return (result.Items ?? []).map((item) =>
      toCostFindingRecord(item as CostFindingItem),
    );
  }
}
