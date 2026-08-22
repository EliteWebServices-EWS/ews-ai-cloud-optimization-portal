import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  actionLogCanonicalSortKey,
  actionLogCorrelationSortKeyPrefix,
  actionLogDecisionSortKeyPrefix,
  actionLogExecutionSortKeyPrefix,
  actionLogResourceSortKeyPrefix,
  tenantPartitionKey,
} from '../../database';
import { DynamoDbActionLogRepository } from '../../repositories/dynamodb/dynamodb-action-log-repository';
import {
  ACCOUNT_A,
  FIXED_OBSERVATION_TS_1,
  RESOURCE_ID_CONFIDENCE_GOLDEN,
  TENANT_A,
} from '../fixtures/evidence/identities';

function createMockClient() {
  const puts: PutCommand['input'][] = [];
  const queries: QueryCommand['input'][] = [];
  const store = new Map<string, Record<string, unknown>>();

  const client = {
    send: async (command: PutCommand | QueryCommand | GetCommand) => {
      if (command instanceof PutCommand) {
        puts.push(command.input);
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
        const item = store.get(`${pk}#${sk}`);
        return { Item: item };
      }

      if (command instanceof QueryCommand) {
        queries.push(command.input);
        const pk = String(
          command.input.ExpressionAttributeValues?.[':pk'],
        );
        const prefix = String(
          command.input.ExpressionAttributeValues?.[':skPrefix'],
        );
        const items = [...store.values()].filter(
          (item) => item.pk === pk && String(item.sk).startsWith(prefix),
        );
        items.sort((left, right) =>
          String(left.sk).localeCompare(String(right.sk)),
        );
        return { Items: items };
      }

      return {};
    },
  } as unknown as DynamoDBDocumentClient;

  return { client, puts, queries, store };
}

test('recordEvent writes canonical and index rows without Scan', async () => {
  const { client, puts } = createMockClient();
  const repository = new DynamoDbActionLogRepository(
    client,
    'sisum-execution-plans-test',
  );

  await repository.recordEvent({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
    correlationId: 'corr-ddb',
    decisionId: 'decision-ddb',
    executionId: 'exec-ddb',
    eventType: 'RECOMMENDATION_OBSERVED',
    sourceStage: 'RECOMMENDATION',
    sourceRecordId: 'obs-ddb',
    occurredAt: FIXED_OBSERVATION_TS_1,
  });

  assert.ok(puts.length >= 4);
  assert.ok(
    puts.every((put) => !String(put.Item?.pk).includes('Scan')),
  );
  assert.equal(
    puts[0]?.Item?.sk,
    actionLogCanonicalSortKey(String(puts[0]?.Item?.logicalEventId)),
  );
});

test('duplicate recordEvent returns existing canonical row', async () => {
  const { client } = createMockClient();
  const repository = new DynamoDbActionLogRepository(
    client,
    'sisum-execution-plans-test',
  );
  const input = {
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    correlationId: 'corr-idempotent',
    eventType: 'PERSISTENCE_EVALUATED' as const,
    sourceStage: 'PERSISTENCE' as const,
    sourceRecordId: 'persist-idempotent',
    occurredAt: FIXED_OBSERVATION_TS_1,
  };

  const first = await repository.recordEvent(input);
  const second = await repository.recordEvent(input);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.event.logicalEventId, second.event.logicalEventId);
});

test('listByCorrelation queries tenant partition with correlation prefix', async () => {
  const { client, queries } = createMockClient();
  const repository = new DynamoDbActionLogRepository(
    client,
    'sisum-execution-plans-test',
  );

  await repository.listByCorrelation(TENANT_A, 'corr-query');

  const query = queries[0];
  assert.equal(query?.ExpressionAttributeValues?.[':pk'], tenantPartitionKey(TENANT_A));
  assert.equal(
    query?.ExpressionAttributeValues?.[':skPrefix'],
    actionLogCorrelationSortKeyPrefix('corr-query'),
  );
  assert.match(query?.KeyConditionExpression ?? '', /begins_with/);
});

test('listByDecision uses decision sort key prefix', async () => {
  const { client, queries } = createMockClient();
  const repository = new DynamoDbActionLogRepository(
    client,
    'sisum-execution-plans-test',
  );

  await repository.listByDecision(TENANT_A, 'decision-query');
  assert.equal(
    queries[0]?.ExpressionAttributeValues?.[':skPrefix'],
    actionLogDecisionSortKeyPrefix('decision-query'),
  );
});

test('listByExecution uses execution sort key prefix', async () => {
  const { client, queries } = createMockClient();
  const repository = new DynamoDbActionLogRepository(
    client,
    'sisum-execution-plans-test',
  );

  await repository.listByExecution(TENANT_A, 'exec-query');
  assert.equal(
    queries[0]?.ExpressionAttributeValues?.[':skPrefix'],
    actionLogExecutionSortKeyPrefix('exec-query'),
  );
});

test('ML featureSchemaVersion survives DynamoDB write and getEvent read', async () => {
  const { client } = createMockClient();
  const repository = new DynamoDbActionLogRepository(
    client,
    'sisum-execution-plans-test',
  );

  const recorded = await repository.recordEvent({
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    correlationId: 'corr-ml-schema',
    eventType: 'ML_EXECUTED',
    sourceStage: 'ML',
    sourceRecordId: 'eval-ml-schema',
    sourceRecordVersion: 'mock-v1',
    modelId: 'mock-model',
    featureSchemaVersion: 'ml-model-contract-v1',
    occurredAt: FIXED_OBSERVATION_TS_1,
    reasonCodes: ['EXECUTED', 'NONE', 'ML_ELIGIBLE'],
  });

  const loaded = await repository.getEvent(TENANT_A, recorded.event.logicalEventId);
  assert.equal(loaded?.featureSchemaVersion, 'ml-model-contract-v1');
  assert.equal(loaded?.modelId, 'mock-model');
  assert.ok(!loaded?.reasonCodes?.includes('ml-model-contract-v1'));
});

test('listByResource uses account-scoped sort key prefix', async () => {
  const { client, queries } = createMockClient();
  const repository = new DynamoDbActionLogRepository(
    client,
    'sisum-execution-plans-test',
  );

  await repository.listByResource(TENANT_A, ACCOUNT_A, RESOURCE_ID_CONFIDENCE_GOLDEN);
  assert.equal(
    queries[0]?.ExpressionAttributeValues?.[':skPrefix'],
    actionLogResourceSortKeyPrefix(ACCOUNT_A, RESOURCE_ID_CONFIDENCE_GOLDEN),
  );
});
