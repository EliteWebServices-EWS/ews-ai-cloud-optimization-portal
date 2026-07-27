/**
 * DynamoDB access for durable business persistence (reports, learning,
 * verification, and the cross-cutting ownership index). Each entity type has
 * its own physical table (PAY_PER_REQUEST, string pk/sk, server-side
 * encryption, and point-in-time recovery), mirroring the audit table.
 *
 * Item envelope:
 *   { pk, sk, entityType, data: <domain object>, ...denormalized fields }
 *
 * Storing the domain object under `data` keeps adapters resilient to schema
 * evolution; the DynamoDB Document client marshals nested JSON natively.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';

import { isConditionalCheckFailure, RepositoryConflictError } from '../database';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizePageSize,
} from '../repositories/contracts/repository-types';
import { decodeNextToken, encodeNextToken } from '../database/pagination-token';

import {
  decodeScopedNextToken,
  encodeScopedNextToken,
  type ScopedPaginationContext,
} from './scoped-pagination-token';
import { executeTransactWrite, type TransactPutOperation } from './transact-write';

/** A stored item: envelope keys plus arbitrary domain attributes. */
export type PersistedItem = Record<string, unknown> & {
  pk: string;
  sk: string;
};

/** Partition key for all tenant-scoped items. */
export function buildTenantPartitionKey(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

/**
 * Tenant-isolated persistence table wrapper.
 *
 * All query helpers are scoped to a single partition key; ownership-index
 * lookups that intentionally cross tenants use their own global partition
 * keys and are issued via getItem.
 */
export class PersistenceTable {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(options: {
    tableName: string;
    client?: DynamoDBDocumentClient;
  }) {
    this.tableName = options.tableName;
    this.client =
      options.client ??
      DynamoDBDocumentClient.from(new DynamoDBClient({}), {
        marshallOptions: { removeUndefinedValues: true },
      });
  }

  get name(): string {
    return this.tableName;
  }

  get documentClient(): DynamoDBDocumentClient {
    return this.client;
  }

  async putItem(item: PersistedItem): Promise<void> {
    await this.client.send(
      new PutCommand({ TableName: this.tableName, Item: item })
    );
  }

  async putItemConditional(
    item: PersistedItem,
    options: {
      conditionExpression: string;
      expressionAttributeNames?: Record<string, string>;
      expressionAttributeValues?: Record<string, unknown>;
    }
  ): Promise<void> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: options.conditionExpression,
          ExpressionAttributeNames: options.expressionAttributeNames,
          ExpressionAttributeValues: options.expressionAttributeValues,
        })
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new RepositoryConflictError();
      }

      throw error;
    }
  }

  async transactPutItems(
    operations: Omit<TransactPutOperation, 'tableName'>[]
  ): Promise<void> {
    await executeTransactWrite(
      this.client,
      operations.map((operation) => ({
        ...operation,
        tableName: this.tableName,
      }))
    );
  }

  /** Write several items; DynamoDB has no cross-partition transaction here,
   * so callers should tolerate partial writes on failure (all are idempotent). */
  async putItems(items: PersistedItem[]): Promise<void> {
    for (const item of items) {
      await this.putItem(item);
    }
  }

  async getItem(
    pk: string,
    sk: string
  ): Promise<PersistedItem | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk },
      })
    );

    return result.Item as PersistedItem | undefined;
  }

  async deleteItem(pk: string, sk: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk, sk },
      })
    );
  }

  /**
   * Query every item under a partition key whose sort key begins with the
   * given prefix, transparently following DynamoDB pagination.
   */
  async queryByPrefix(
    pk: string,
    skPrefix: string
  ): Promise<PersistedItem[]> {
    const items: PersistedItem[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const input: QueryCommandInput = {
        TableName: this.tableName,
        KeyConditionExpression:
          'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':skPrefix': skPrefix,
        },
        ExclusiveStartKey: exclusiveStartKey,
      };

      const result = await this.client.send(new QueryCommand(input));

      for (const item of result.Items ?? []) {
        items.push(item as PersistedItem);
      }

      exclusiveStartKey = result.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (exclusiveStartKey);

    return items;
  }

  /**
   * Query one DynamoDB page under a tenant partition key prefix.
   */
  async queryPageByPrefix(options: {
    pk: string;
    skPrefix: string;
    limit?: number;
    nextToken?: string;
    scanIndexForward?: boolean;
    paginationContext?: ScopedPaginationContext;
  }): Promise<{
    items: PersistedItem[];
    nextToken?: string;
  }> {
    const limit = normalizePageSize(options.limit ?? DEFAULT_PAGE_SIZE);
    if (limit > MAX_PAGE_SIZE) {
      throw new Error(`Pagination limit cannot exceed ${MAX_PAGE_SIZE}.`);
    }

    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (options.nextToken) {
      if (options.paginationContext) {
        exclusiveStartKey = decodeScopedNextToken(
          options.nextToken,
          options.paginationContext
        );
      } else {
        exclusiveStartKey = decodeNextToken(options.nextToken);
      }
    }

    const input: QueryCommandInput = {
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': options.pk,
        ':skPrefix': options.skPrefix,
      },
      ExclusiveStartKey: exclusiveStartKey,
      Limit: limit,
      ScanIndexForward: options.scanIndexForward ?? true,
    };

    const result = await this.client.send(new QueryCommand(input));
    const items = (result.Items ?? []).map((item) => item as PersistedItem);

    const nextToken = options.paginationContext
      ? encodeScopedNextToken(
          options.paginationContext,
          result.LastEvaluatedKey as Record<string, unknown> | undefined
        )
      : encodeNextToken(result.LastEvaluatedKey as Record<string, unknown> | undefined);

    return { items, nextToken };
  }
}

/** Persistence is active unless explicitly disabled. */
export function isPersistenceEnabled(): boolean {
  return process.env.PERSISTENCE_ENABLED?.trim().toLowerCase() !== 'false';
}

/**
 * Builds a memoized accessor for one physical table, resolved from the given
 * environment variable. Returns null when persistence is disabled or the
 * table name is not configured (local dev / tests default to mock
 * repositories).
 */
function createTableAccessor(envVarName: string) {
  let cached: PersistenceTable | null = null;

  return {
    get(): PersistenceTable | null {
      if (!isPersistenceEnabled()) {
        return null;
      }

      const tableName = process.env[envVarName]?.trim();

      if (!tableName) {
        return null;
      }

      if (!cached) {
        cached = new PersistenceTable({ tableName });
      }

      return cached;
    },
    /** Override the memoized table (used by tests to inject a fake client). */
    set(table: PersistenceTable | null): void {
      cached = table;
    },
    /** Reset the memoized table. */
    reset(): void {
      cached = null;
    },
  };
}

const reportsAccessor = createTableAccessor('REPORTS_TABLE_NAME');
const learningAccessor = createTableAccessor('LEARNING_TABLE_NAME');
const verificationsAccessor = createTableAccessor('VERIFICATIONS_TABLE_NAME');
const ownershipAccessor = createTableAccessor('OWNERSHIP_TABLE_NAME');

export const getReportsTable = reportsAccessor.get;
export const setReportsTable = reportsAccessor.set;
export const resetReportsTable = reportsAccessor.reset;

export const getLearningTable = learningAccessor.get;
export const setLearningTable = learningAccessor.set;
export const resetLearningTable = learningAccessor.reset;

export const getVerificationsTable = verificationsAccessor.get;
export const setVerificationsTable = verificationsAccessor.set;
export const resetVerificationsTable = verificationsAccessor.reset;

export const getOwnershipTable = ownershipAccessor.get;
export const setOwnershipTable = ownershipAccessor.set;
export const resetOwnershipTable = ownershipAccessor.reset;

/** Reset all memoized tables (used between tests). */
export function resetAllPersistenceTables(): void {
  reportsAccessor.reset();
  learningAccessor.reset();
  verificationsAccessor.reset();
  ownershipAccessor.reset();
}
