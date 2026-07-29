import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import { RepositoryAlreadyExistsError } from '../../database';

import { DynamoDbExecutionHistoryRepository } from '../../repositories/dynamodb/dynamodb-execution-history-repository';

test('append rejects duplicate history IDs', async () => {
  let putCount = 0;

  const client = {
    send: async (command: PutCommand | QueryCommand) => {
      if (command instanceof PutCommand) {
        putCount += 1;
        if (putCount > 1) {
          const error = new Error('ConditionalCheckFailedException');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
      }
      return {};
    },
  } as unknown as DynamoDBDocumentClient;

  const repository = new DynamoDbExecutionHistoryRepository(
    client,
    'sisum-execution-plans-test',
  );

  const entry = {
    historyId: 'hist-1',
    tenantId: 'tenant-1',
    executionId: 'exec-1',
    workflowId: 'wf-1',
    eventType: 'PLAN_CREATED' as const,
    actorId: 'user-1',
    createdAt: '2026-07-29T10:00:00.000Z',
  };

  await repository.append(entry);

  await assert.rejects(
    () => repository.append(entry),
    RepositoryAlreadyExistsError,
  );
});

test('listByExecution queries tenant partition with history prefix', async () => {
  let queryInput: QueryCommand['input'] | undefined;

  const client = {
    send: async (command: QueryCommand) => {
      queryInput = command.input;
      return { Items: [] };
    },
  } as unknown as DynamoDBDocumentClient;

  const repository = new DynamoDbExecutionHistoryRepository(
    client,
    'sisum-execution-plans-test',
  );

  await repository.listByExecution('tenant-1', 'exec-1');

  assert.match(
    queryInput?.KeyConditionExpression ?? '',
    /begins_with/,
  );
});
