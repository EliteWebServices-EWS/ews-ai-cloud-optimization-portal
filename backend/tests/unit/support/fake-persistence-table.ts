/**
 * In-memory fake of DynamoDBDocumentClient for exercising the DynamoDB
 * repository adapters without AWS. Supports the exact command shapes the
 * PersistenceTable issues: Put/Get/Delete by {pk, sk} and Query with
 * `pk = :pk AND begins_with(sk, :skPrefix)`.
 */

import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { PersistenceTable } from '../../../persistence/persistence-table';

function itemKey(pk: string, sk: string): string {
  return `${pk}||${sk}`;
}

export class FakeDocumentClient {
  readonly store = new Map<string, Record<string, unknown>>();

  async send(command: unknown): Promise<unknown> {
    if (command instanceof PutCommand) {
      const item = command.input.Item as Record<string, unknown>;
      this.store.set(
        itemKey(item.pk as string, item.sk as string),
        structuredClone(item)
      );
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

      const items = Array.from(this.store.values())
        .filter(
          (item) =>
            item.pk === pk &&
            typeof item.sk === 'string' &&
            (item.sk as string).startsWith(skPrefix)
        )
        .sort((left, right) =>
          (left.sk as string).localeCompare(right.sk as string)
        )
        .map((item) => structuredClone(item));

      return { Items: items, LastEvaluatedKey: undefined };
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
