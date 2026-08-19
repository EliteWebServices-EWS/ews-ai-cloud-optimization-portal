import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  actionLogDecisionSortKeyPrefix,
  tenantPartitionKey,
} from '../../database';
import { DynamoDbActionLogRepository } from '../../repositories/dynamodb/dynamodb-action-log-repository';
import {
  ACCOUNT_A,
  FIXED_OBSERVATION_TS_1,
  RESOURCE_ID_CONFIDENCE_GOLDEN,
  TENANT_A,
} from '../fixtures/evidence/identities';

function createFaultInjectedClient(options?: { failOnPutAttempt?: number }) {
  const store = new Map<string, Record<string, unknown>>();
  let putAttempts = 0;

  const client = {
    send: async (command: PutCommand | QueryCommand | GetCommand) => {
      if (command instanceof PutCommand) {
        putAttempts += 1;
        if (options?.failOnPutAttempt === putAttempts) {
          throw new Error(`InjectedPutFailure#${putAttempts}`);
        }

        const item = command.input.Item as Record<string, unknown>;
        const pk = String(item.pk);
        const sk = String(item.sk);
        if (
          command.input.ConditionExpression?.includes('attribute_not_exists') &&
          store.has(`${pk}#${sk}`)
        ) {
          const error = new Error('ConditionalCheckFailedException');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
        store.set(`${pk}#${sk}`, item);
        return {};
      }

      if (command instanceof GetCommand) {
        const pk = String(command.input.Key?.pk);
        const sk = String(command.input.Key?.sk);
        return { Item: store.get(`${pk}#${sk}`) };
      }

      if (command instanceof QueryCommand) {
        const pk = String(command.input.ExpressionAttributeValues?.[':pk']);
        const prefix = String(command.input.ExpressionAttributeValues?.[':skPrefix']);
        const items = [...store.values()].filter(
          (item) => item.pk === pk && String(item.sk).startsWith(prefix),
        );
        items.sort((left, right) => String(left.sk).localeCompare(String(right.sk)));
        return { Items: items };
      }

      return {};
    },
  } as unknown as DynamoDBDocumentClient;

  return { client, store };
}

const baseInput = {
  tenantId: TENANT_A,
  accountId: ACCOUNT_A,
  resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
  correlationId: 'corr-durability',
  decisionId: 'decision-durability',
  eventType: 'RECOMMENDATION_OBSERVED' as const,
  sourceStage: 'RECOMMENDATION' as const,
  sourceRecordId: 'obs-durability',
  occurredAt: FIXED_OBSERVATION_TS_1,
};

test('failure before any write leaves no rows', async () => {
  const { client, store } = createFaultInjectedClient({ failOnPutAttempt: 1 });
  const repository = new DynamoDbActionLogRepository(client, 'table');

  await assert.rejects(() => repository.recordEvent(baseInput), /InjectedPutFailure/);
  assert.equal(store.size, 0);
});

test('failure after canonical write is repaired on retry', async () => {
  const { client, store } = createFaultInjectedClient({ failOnPutAttempt: 2 });
  const repository = new DynamoDbActionLogRepository(client, 'table');

  await assert.rejects(() => repository.recordEvent(baseInput), /InjectedPutFailure/);
  assert.equal(store.size, 1);

  const repaired = await repository.recordEvent(baseInput);
  assert.equal(repaired.created, false);
  assert.ok(store.size >= 4);
});

test('failure after one projection write is repaired on retry without duplicate rows', async () => {
  const { client, store } = createFaultInjectedClient({ failOnPutAttempt: 3 });
  const repository = new DynamoDbActionLogRepository(client, 'table');

  await assert.rejects(() => repository.recordEvent(baseInput), /InjectedPutFailure/);
  const rowsBeforeRetry = store.size;
  assert.ok(rowsBeforeRetry >= 2);

  const retry = await repository.recordEvent(baseInput);
  assert.equal(retry.created, false);
  assert.ok(store.size > rowsBeforeRetry);

  const decisionRows = [...store.values()].filter((item) =>
    String(item.sk).startsWith(actionLogDecisionSortKeyPrefix('decision-durability')),
  );
  assert.equal(decisionRows.length, 1);
});

test('duplicate retry after complete success remains idempotent', async () => {
  const { client, store } = createFaultInjectedClient();
  const repository = new DynamoDbActionLogRepository(client, 'table');

  const first = await repository.recordEvent(baseInput);
  const second = await repository.recordEvent(baseInput);
  const sizeAfterFirst = store.size;

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(store.size, sizeAfterFirst);
});

test('repair restores decision query path after partial projection failure', async () => {
  const { client } = createFaultInjectedClient({ failOnPutAttempt: 3 });
  const repository = new DynamoDbActionLogRepository(client, 'table');

  await assert.rejects(() => repository.recordEvent(baseInput));
  await repository.recordEvent(baseInput);

  const page = await repository.listByDecision(TENANT_A, 'decision-durability');
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.correlationId, 'corr-durability');
});

test('list query never returns non-ActionLog entity types on shared tenant partition', async () => {
  const { client, store } = createFaultInjectedClient();
  const repository = new DynamoDbActionLogRepository(client, 'table');
  await repository.recordEvent(baseInput);

  store.set(`${tenantPartitionKey(TENANT_A)}#EXECUTION#exec-1`, {
    pk: tenantPartitionKey(TENANT_A),
    sk: 'EXECUTION#exec-1',
    entityType: 'EXECUTION',
    tenantId: TENANT_A,
    correlationId: 'corr-durability',
    eventType: 'RECOMMENDATION_OBSERVED',
    sourceStage: 'RECOMMENDATION',
    sourceRecordId: 'wrong',
    occurredAt: FIXED_OBSERVATION_TS_1,
    recordedAt: FIXED_OBSERVATION_TS_1,
    orderKey: 'x',
    logicalEventId: 'wrong',
    eventId: 'wrong',
    eventVersion: 1,
  });

  const page = await repository.listByCorrelation(TENANT_A, 'corr-durability');
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.sourceRecordId, 'obs-durability');
});
