/**
 * In-memory fake of DynamoDBDocumentClient for exercising the DynamoDB
 * repository adapters without AWS.
 */

import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { PersistenceTable } from '../../../persistence/persistence-table';

function itemKey(pk: string, sk: string): string {
  return `${pk}||${sk}`;
}

function evaluateCondition(
  item: Record<string, unknown> | undefined,
  conditionExpression: string | undefined,
  expressionAttributeValues?: Record<string, unknown>
): boolean {
  if (!conditionExpression) {
    return true;
  }

  const values = expressionAttributeValues ?? {};

  if (
    conditionExpression.includes('attribute_not_exists(pk)') &&
    conditionExpression.includes('attribute_not_exists(sk)')
  ) {
    return item === undefined;
  }

  if (conditionExpression.includes('attribute_not_exists(pk) OR')) {
    if (!item) {
      return true;
    }

    const owner = values[':owner'];
    return item.ownerTenantId === owner || item.tenantId === owner;
  }

  return true;
}

export class FakeDocumentClient {
  readonly store = new Map<string, Record<string, unknown>>();

  async send(command: unknown): Promise<unknown> {
    if (command instanceof PutCommand) {
      const item = command.input.Item as Record<string, unknown>;
      const key = itemKey(item.pk as string, item.sk as string);
      const existing = this.store.get(key);

      if (
        !evaluateCondition(
          existing,
          command.input.ConditionExpression,
          command.input.ExpressionAttributeValues
        )
      ) {
        const error = new Error('ConditionalCheckFailedException');
        error.name = 'ConditionalCheckFailedException';
        throw error;
      }

      this.store.set(key, structuredClone(item));
      return {};
    }

    if (command instanceof GetCommand) {
      const key = command.input.Key as { pk: string; sk: string };
      const item = this.store.get(itemKey(key.pk, key.sk));
      return { Item: item ? structuredClone(item) : undefined };
    }

    if (command instanceof DeleteCommand) {
      const key = command.input.Key as { pk: string; sk: string };
      this.store.delete(itemKey(key.pk, key.sk));
      return {};
    }

    if (command instanceof QueryCommand) {
      const values = command.input.ExpressionAttributeValues ?? {};
      const pk = values[':pk'] as string;
      const skPrefix = (values[':skPrefix'] as string | undefined) ?? '';

      const matching = Array.from(this.store.values())
        .filter(
          (item) =>
            item.pk === pk &&
            typeof item.sk === 'string' &&
            (item.sk as string).startsWith(skPrefix)
        )
        .sort((left, right) =>
          (left.sk as string).localeCompare(right.sk as string)
        );

      const scanIndexForward = command.input.ScanIndexForward ?? true;
      const sorted = scanIndexForward
        ? matching
        : [...matching].reverse();

      const limit = command.input.Limit ?? sorted.length;
      let startIndex = 0;

      if (command.input.ExclusiveStartKey) {
        const startKey = command.input.ExclusiveStartKey as {
          pk: string;
          sk: string;
        };
        const startPos = sorted.findIndex(
          (item) =>
            item.pk === startKey.pk && item.sk === startKey.sk
        );
        startIndex = startPos >= 0 ? startPos + 1 : 0;
      }

      const pageItems = sorted
        .slice(startIndex, startIndex + limit)
        .map((item) => structuredClone(item));

      const lastItem = pageItems.at(-1);
      const hasMore = startIndex + limit < sorted.length;
      const lastEvaluatedKey =
        hasMore && lastItem
          ? { pk: lastItem.pk, sk: lastItem.sk }
          : undefined;

      return { Items: pageItems, LastEvaluatedKey: lastEvaluatedKey };
    }

    if (command instanceof TransactWriteCommand) {
      const items = command.input.TransactItems ?? [];
      const snapshots = new Map<string, Record<string, unknown> | undefined>();

      for (const transactionItem of items) {
        const put = transactionItem.Put;
        if (!put?.Item) {
          throw new Error('FakeDocumentClient supports transact Put only.');
        }

        const item = put.Item as Record<string, unknown>;
        const key = itemKey(item.pk as string, item.sk as string);
        snapshots.set(key, this.store.get(key));

        if (
          !evaluateCondition(
            this.store.get(key),
            put.ConditionExpression,
            put.ExpressionAttributeValues
          )
        ) {
          const error = new Error('ConditionalCheckFailedException');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
      }

      for (const transactionItem of items) {
        const put = transactionItem.Put;
        if (!put?.Item) {
          continue;
        }

        const item = put.Item as Record<string, unknown>;
        const key = itemKey(item.pk as string, item.sk as string);
        this.store.set(key, structuredClone(item));
      }

      return {};
    }

    throw new Error(
      `FakeDocumentClient received unsupported command: ${
        (command as { constructor?: { name?: string } })?.constructor?.name
      }`
    );
  }
}

/** Build a PersistenceTable backed by the in-memory fake client. */
export function createFakePersistenceTable(): PersistenceTable {
  const client = new FakeDocumentClient();
  return new PersistenceTable({
    tableName: 'sisum-persistence-test',
    client: client as unknown as DynamoDBDocumentClient,
  });
}

export function createLinkedFakePersistenceTables(): {
  reports: PersistenceTable;
  ownership: PersistenceTable;
  client: FakeDocumentClient;
} {
  const client = new FakeDocumentClient();
  const documentClient = client as unknown as DynamoDBDocumentClient;

  return {
    client,
    reports: new PersistenceTable({
      tableName: 'sisum-reports-test',
      client: documentClient,
    }),
    ownership: new PersistenceTable({
      tableName: 'sisum-ownership-test',
      client: documentClient,
    }),
  };
}
