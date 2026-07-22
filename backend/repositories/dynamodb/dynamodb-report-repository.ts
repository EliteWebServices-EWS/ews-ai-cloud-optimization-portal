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
  reportSortKey,
  tenantPartitionKey,
  workflowResourceIndexPartitionKey,
} from '../../database';

import type {
  CreateReportInput,
  PageRequest,
  PageResult,
  ReportRepository,
  UpdateOptions,
  UpdateReportInput,
} from '../contracts';

import { normalizePageSize } from '../contracts/repository-types';

import type { ReportRecord } from '../models';

import { BaseDynamoDbRepository } from './base-dynamodb-repository';

interface ReportItem extends ReportRecord {
  pk: string;
  sk: string;
  entityType: 'REPORT';
  gsi1pk: string;
  gsi1sk: string;
}

function toReportRecord(item: ReportItem): ReportRecord {
  return {
    tenantId: item.tenantId,
    reportId: item.reportId,
    workflowId: item.workflowId,
    reportType: item.reportType,
    status: item.status,
    title: item.title,
    content: item.content,
    expiresAt: item.expiresAt,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export class DynamoDbReportRepository
  extends BaseDynamoDbRepository
  implements ReportRepository
{
  public constructor(
    client: DynamoDBDocumentClient,
    tableName: string,
  ) {
    super(client, tableName);
  }

  public async create(
    input: CreateReportInput,
  ): Promise<ReportRecord> {
    const now = new Date().toISOString();

    const record: ReportRecord = {
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const item: ReportItem = {
      pk: tenantPartitionKey(record.tenantId),
      sk: reportSortKey(record.reportId),
      entityType: 'REPORT',
      gsi1pk: workflowResourceIndexPartitionKey(
        record.tenantId,
        record.workflowId,
      ),
      gsi1sk: createdAtIndexSortKey(
        record.createdAt,
        'REPORT',
        record.reportId,
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
          `Report ${record.reportId} already exists.`,
        );
      }

      throw error;
    }

    return record;
  }

  public async get(
    tenantId: string,
    reportId: string,
  ): Promise<ReportRecord | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: tenantPartitionKey(tenantId),
          sk: reportSortKey(reportId),
        },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return undefined;
    }

    return toReportRecord(result.Item as ReportItem);
  }

  public async update(
    tenantId: string,
    reportId: string,
    changes: UpdateReportInput,
    options: UpdateOptions,
  ): Promise<ReportRecord> {
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
            sk: reportSortKey(reportId),
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
          `Report ${reportId} was not found.`,
        );
      }

      return toReportRecord(
        result.Attributes as ReportItem,
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError(
          `Report ${reportId} could not be updated because its version changed or it no longer exists.`,
        );
      }

      throw error;
    }
  }

  public async delete(
    tenantId: string,
    reportId: string,
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
            sk: reportSortKey(reportId),
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
          `Report ${reportId} could not be deleted because it does not exist or its version changed.`,
        );
      }

      throw error;
    }
  }

  public async listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<ReportRecord>> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression:
          '#pk = :pk AND begins_with(#sk, :reportPrefix)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': tenantPartitionKey(tenantId),
          ':reportPrefix': 'REPORT#',
        },
        ExclusiveStartKey: decodeNextToken(
          page?.nextToken,
        ),
        Limit: normalizePageSize(page?.limit),
        ScanIndexForward: false,
      }),
    );

    const items = (result.Items ?? []).map((item) =>
      toReportRecord(item as ReportItem),
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
  ): Promise<PageResult<ReportRecord>> {
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
      toReportRecord(item as ReportItem),
    );

    return {
      items,
      nextToken: encodeNextToken(
        result.LastEvaluatedKey,
      ),
    };
  }
}