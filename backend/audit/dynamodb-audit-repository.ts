import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { AuditEvent } from './audit-types';
import type { AuditRepository } from './audit-repository';
import {
  buildAuditPartitionKey,
  buildAuditSortKey,
  fromDynamoDbItem,
  toAuditRecord,
  toDynamoDbItem,
  type AuditQueryFilters,
  type AuditQueryResult,
} from './audit-query';

function encodeNextToken(
  key: Record<string, unknown> | undefined
): string | undefined {
  if (!key) {
    return undefined;
  }

  return Buffer.from(
    JSON.stringify(key),
    'utf8'
  ).toString('base64url');
}

function decodeNextToken(
  token: string | undefined
): Record<string, unknown> | undefined {
  if (!token) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(
      token,
      'base64url'
    ).toString('utf8');

    const parsed = JSON.parse(decoded);

    if (
      typeof parsed !== 'object' ||
      parsed === null
    ) {
      return undefined;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function buildFilterExpression(
  filters: AuditQueryFilters
): {
  filterExpression?: string;
  expressionAttributeNames: Record<string, string>;
  expressionAttributeValues: Record<string, unknown>;
} {
  const parts: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, unknown> = {};

  if (filters.eventName) {
    parts.push('#eventName = :eventName');
    expressionAttributeNames['#eventName'] = 'eventName';
    expressionAttributeValues[':eventName'] =
      filters.eventName;
  }

  if (filters.outcome) {
    parts.push('#outcome = :outcome');
    expressionAttributeNames['#outcome'] = 'outcome';
    expressionAttributeValues[':outcome'] =
      filters.outcome;
  }

  if (filters.actorUserId) {
    parts.push('#actorUserId = :actorUserId');
    expressionAttributeNames['#actorUserId'] =
      'actorUserId';
    expressionAttributeValues[':actorUserId'] =
      filters.actorUserId;
  }

  if (filters.workflowId) {
    parts.push('#workflowId = :workflowId');
    expressionAttributeNames['#workflowId'] =
      'workflowId';
    expressionAttributeValues[':workflowId'] =
      filters.workflowId;
  }

  if (filters.requestId) {
    parts.push('#requestId = :requestId');
    expressionAttributeNames['#requestId'] =
      'requestId';
    expressionAttributeValues[':requestId'] =
      filters.requestId;
  }

  if (filters.correlationId) {
    parts.push(
      '#correlationId = :correlationId'
    );
    expressionAttributeNames['#correlationId'] =
      'correlationId';
    expressionAttributeValues[':correlationId'] =
      filters.correlationId;
  }

  return {
    filterExpression:
      parts.length > 0
        ? parts.join(' AND ')
        : undefined,
    expressionAttributeNames,
    expressionAttributeValues,
  };
}

export interface DynamoDbAuditRepositoryOptions {
  tableName: string;
  client?: DynamoDBDocumentClient;
}

export class DynamoDbAuditRepository
  implements AuditRepository
{
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(
    options: DynamoDbAuditRepositoryOptions
  ) {
    this.tableName = options.tableName;

    this.client =
      options.client ??
      DynamoDBDocumentClient.from(
        new DynamoDBClient({})
      );
  }

  async save(event: AuditEvent): Promise<void> {
    const record = toAuditRecord(event);
    const item = toDynamoDbItem(record);

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
  }

  async query(
    filters: AuditQueryFilters
  ): Promise<AuditQueryResult> {
    const pk = buildAuditPartitionKey(
      filters.tenantId
    );

    const keyConditionParts = ['pk = :pk'];
    const expressionAttributeValues: Record<
      string,
      unknown
    > = {
      ':pk': pk,
    };

    if (filters.from && filters.to) {
      keyConditionParts.push(
        'sk BETWEEN :fromSk AND :toSk'
      );
      expressionAttributeValues[':fromSk'] =
        `AUDIT#${filters.from}`;
      expressionAttributeValues[':toSk'] =
        `AUDIT#${filters.to}~`;
    } else if (filters.from) {
      keyConditionParts.push('sk >= :fromSk');
      expressionAttributeValues[':fromSk'] =
        `AUDIT#${filters.from}`;
    } else if (filters.to) {
      keyConditionParts.push('sk <= :toSk');
      expressionAttributeValues[':toSk'] =
        `AUDIT#${filters.to}~`;
    }

    const {
      filterExpression,
      expressionAttributeNames,
      expressionAttributeValues:
        filterAttributeValues,
    } = buildFilterExpression(filters);

    Object.assign(
      expressionAttributeValues,
      filterAttributeValues
    );

    const exclusiveStartKey = decodeNextToken(
      filters.nextToken
    );

    const input: QueryCommandInput = {
      TableName: this.tableName,
      KeyConditionExpression:
        keyConditionParts.join(' AND '),
      ExpressionAttributeValues:
        expressionAttributeValues,
      ScanIndexForward: false,
      Limit: filters.limit,
      ExclusiveStartKey: exclusiveStartKey,
    };

    if (filterExpression) {
      input.FilterExpression = filterExpression;
      input.ExpressionAttributeNames =
        expressionAttributeNames;
    }

    const result = await this.client.send(
      new QueryCommand(input)
    );

    const items = (result.Items ?? []).map(
      (item) =>
        fromDynamoDbItem(
          item as Record<string, unknown>
        )
    );

    return {
      items,
      nextToken: encodeNextToken(
        result.LastEvaluatedKey as
          | Record<string, unknown>
          | undefined
      ),
    };
  }
}

export function buildAuditSortKeyForTest(
  timestampIso: string,
  eventId: string
): string {
  return buildAuditSortKey(timestampIso, eventId);
}

export function buildAuditPartitionKeyForTest(
  tenantId: string
): string {
  return buildAuditPartitionKey(tenantId);
}
