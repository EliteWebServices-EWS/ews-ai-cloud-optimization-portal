/**
 * Shared DynamoDB access for durable business persistence (reports, learning,
 * verification). Single-table design mirroring the audit table: PAY_PER_REQUEST,
 * string pk/sk, server-side encryption, and point-in-time recovery.
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

  async putItem(item: PersistedItem): Promise<void> {
    await this.client.send(
      new PutCommand({ TableName: this.tableName, Item: item })
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
}

let sharedTable: PersistenceTable | null = null;

/** Persistence is active only when a table name is configured and not disabled. */
export function isPersistenceEnabled(): boolean {
  if (
    process.env.PERSISTENCE_ENABLED?.trim().toLowerCase() === 'false'
  ) {
    return false;
  }

  return Boolean(process.env.PERSISTENCE_TABLE_NAME?.trim());
}

/**
 * Resolve the shared persistence table, or null when persistence is not
 * configured (local dev / tests default to mock repositories).
 */
export function getPersistenceTable(): PersistenceTable | null {
  if (!isPersistenceEnabled()) {
    return null;
  }

  const tableName = process.env.PERSISTENCE_TABLE_NAME!.trim();

  if (!sharedTable) {
    sharedTable = new PersistenceTable({ tableName });
  }

  return sharedTable;
}

/** Override the shared table (used by tests to inject a fake client). */
export function setPersistenceTable(
  table: PersistenceTable | null
): void {
  sharedTable = table;
}

/** Reset the memoized shared table. */
export function resetPersistenceTable(): void {
  sharedTable = null;
}
