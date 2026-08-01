import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

import {
  awsAccountGlobalIndexPartitionKey,
  awsAccountSortKey,
  awsAccountStatusIndexPartitionKey,
  tenantPartitionKey,
} from '../../database';

import {
  RepositoryAlreadyExistsError,
} from '../../database';

import { DynamoDbAwsAccountRepository } from '../../repositories/dynamodb/dynamodb-aws-account-repository';
import type { CreateAwsAccountInput } from '../../repositories/contracts';

type Command =
  | GetCommand
  | PutCommand
  | QueryCommand
  | UpdateCommand
  | TransactWriteCommand;

function createInput(): CreateAwsAccountInput {
  return {
    accountId: '123456789012',
    tenantId: 'tenant-a',
    roleArn: 'arn:aws:iam::123456789012:role/SisumOnboardingRole',
    externalId: 'external-id',
    region: 'ap-southeast-2',
    status: 'PENDING',
    verificationStatus: 'NOT_STARTED',
    metadata: {},
  };
}

test('create uses TransactWrite with conditional puts', async () => {
  let transactCount = 0;

  const client = {
    send: async (command: Command) => {
      if (command instanceof TransactWriteCommand) {
        transactCount += 1;
        if (transactCount > 1) {
          const error = new Error('ConditionalCheckFailedException');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
      }
      return {};
    },
  } as unknown as DynamoDBDocumentClient;

  const repository = new DynamoDbAwsAccountRepository(
    client,
    'sisum-aws-accounts-test',
  );

  await repository.create(createInput());

  await assert.rejects(
    () => repository.create(createInput()),
    RepositoryAlreadyExistsError,
  );
});

function createTransactClient(
  transactError: Error,
): DynamoDBDocumentClient {
  return {
    send: async (command: Command) => {
      if (command instanceof TransactWriteCommand) {
        throw transactError;
      }
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
}

test('duplicate create in same tenant maps TransactionCanceled conditional failure to RepositoryAlreadyExistsError', async () => {
  const error = new TransactionCanceledException({
    message: 'Transaction cancelled',
    CancellationReasons: [
      { Code: 'ConditionalCheckFailed' },
      { Code: 'None' },
    ],
    $metadata: {},
  });

  const repository = new DynamoDbAwsAccountRepository(
    createTransactClient(error),
    'sisum-aws-accounts-test',
  );

  await assert.rejects(
    () => repository.create(createInput()),
    RepositoryAlreadyExistsError,
  );
});

test('existing global lock maps TransactionCanceled conditional failure to RepositoryAlreadyExistsError', async () => {
  const error = new TransactionCanceledException({
    message: 'Transaction cancelled',
    CancellationReasons: [
      { Code: 'None' },
      { Code: 'ConditionalCheckFailed' },
    ],
    $metadata: {},
  });

  const repository = new DynamoDbAwsAccountRepository(
    createTransactClient(error),
    'sisum-aws-accounts-test',
  );

  await assert.rejects(
    () => repository.create(createInput()),
    RepositoryAlreadyExistsError,
  );
});

test('rethrows TransactionCanceledException without conditional failure unchanged', async () => {
  const error = new TransactionCanceledException({
    message: 'Transaction conflict',
    CancellationReasons: [{ Code: 'TransactionConflict' }],
    $metadata: {},
  });

  const repository = new DynamoDbAwsAccountRepository(
    createTransactClient(error),
    'sisum-aws-accounts-test',
  );

  await assert.rejects(
    () => repository.create(createInput()),
    (thrown: unknown) => thrown === error,
  );
});

test('rethrows unexpected SDK errors unchanged', async () => {
  const error = new Error('Internal failure');
  error.name = 'InternalServerError';

  const repository = new DynamoDbAwsAccountRepository(
    createTransactClient(error),
    'sisum-aws-accounts-test',
  );

  await assert.rejects(
    () => repository.create(createInput()),
    (thrown: unknown) => thrown === error,
  );
});

test('getById uses tenant-scoped GetCommand keys', async () => {
  let capturedKey: Record<string, string> | undefined;

  const client = {
    send: async (command: Command) => {
      if (command instanceof GetCommand) {
        capturedKey = command.input.Key as Record<string, string>;
        return { Item: undefined };
      }
      return {};
    },
  } as unknown as DynamoDBDocumentClient;

  const repository = new DynamoDbAwsAccountRepository(
    client,
    'sisum-aws-accounts-test',
  );

  await repository.getById('tenant-a', '123456789012');

  assert.deepEqual(capturedKey, {
    pk: tenantPartitionKey('tenant-a'),
    sk: awsAccountSortKey('123456789012'),
  });
});

test('getByAccountId queries gsi1 without Scan', async () => {
  let indexName: string | undefined;
  let gsiPk: string | undefined;
  const commands: string[] = [];

  const client = {
    send: async (command: Command) => {
      if (command instanceof QueryCommand) {
        commands.push('Query');
        indexName = command.input.IndexName;
        gsiPk = command.input.ExpressionAttributeValues?.[':gsi1pk'] as string;
        return { Items: [] };
      }
      return {};
    },
  } as unknown as DynamoDBDocumentClient;

  const repository = new DynamoDbAwsAccountRepository(
    client,
    'sisum-aws-accounts-test',
  );

  await repository.getByAccountId('123456789012');

  assert.deepEqual(commands, ['Query']);
  assert.equal(indexName, 'gsi1');
  assert.equal(
    gsiPk,
    awsAccountGlobalIndexPartitionKey('123456789012'),
  );
});

test('listByStatus queries gsi2', async () => {
  let indexName: string | undefined;
  let gsiPk: string | undefined;

  const client = {
    send: async (command: Command) => {
      if (command instanceof QueryCommand) {
        indexName = command.input.IndexName;
        gsiPk = command.input.ExpressionAttributeValues?.[':gsi2pk'] as string;
        return { Items: [] };
      }
      return {};
    },
  } as unknown as DynamoDBDocumentClient;

  const repository = new DynamoDbAwsAccountRepository(
    client,
    'sisum-aws-accounts-test',
  );

  await repository.listByStatus('tenant-a', 'PENDING');

  assert.equal(indexName, 'gsi2');
  assert.equal(
    gsiPk,
    awsAccountStatusIndexPartitionKey('tenant-a', 'PENDING'),
  );
});

test('update uses optimistic locking and refreshes gsi2 sort key', async () => {
  const input = createInput();
  let updateExpression: string | undefined;

  const client = {
    send: async (command: Command) => {
      if (command instanceof GetCommand) {
        return {
          Item: {
            ...input,
            pk: tenantPartitionKey('tenant-a'),
            sk: awsAccountSortKey('123456789012'),
            entityType: 'AWS_ACCOUNT',
            gsi1pk: awsAccountGlobalIndexPartitionKey('123456789012'),
            gsi1sk: tenantPartitionKey('tenant-a'),
            gsi2pk: awsAccountStatusIndexPartitionKey('tenant-a', 'PENDING'),
            gsi2sk:
              'UPDATED_AT#2026-07-30T00:00:00.000Z#AWS_ACCOUNT#123456789012',
            version: 1,
            createdAt: '2026-07-30T00:00:00.000Z',
            updatedAt: '2026-07-30T00:00:00.000Z',
          },
        };
      }

      if (command instanceof UpdateCommand) {
        updateExpression = command.input.UpdateExpression;
        return {
          Attributes: {
            ...input,
            status: 'VALIDATING',
            verificationStatus: 'IN_PROGRESS',
            pk: tenantPartitionKey('tenant-a'),
            sk: awsAccountSortKey('123456789012'),
            entityType: 'AWS_ACCOUNT',
            gsi1pk: awsAccountGlobalIndexPartitionKey('123456789012'),
            gsi1sk: tenantPartitionKey('tenant-a'),
            gsi2pk: awsAccountStatusIndexPartitionKey('tenant-a', 'VALIDATING'),
            gsi2sk:
              'UPDATED_AT#2026-07-30T00:00:01.000Z#AWS_ACCOUNT#123456789012',
            version: 2,
            createdAt: '2026-07-30T00:00:00.000Z',
            updatedAt: '2026-07-30T00:00:01.000Z',
          },
        };
      }

      return {};
    },
  } as unknown as DynamoDBDocumentClient;

  const repository = new DynamoDbAwsAccountRepository(
    client,
    'sisum-aws-accounts-test',
  );

  const updated = await repository.update(
    'tenant-a',
    '123456789012',
    { status: 'VALIDATING', verificationStatus: 'IN_PROGRESS' },
    { expectedVersion: 1 },
  );

  assert.equal(updated.version, 2);
  assert.match(updateExpression ?? '', /#gsi2sk = :gsi2skValue/);
  assert.match(updateExpression ?? '', /#version = #version \+ :one/);
});

test('listByTenant uses base-table Query with AWS account prefix', async () => {
  let keyCondition: string | undefined;

  const client = {
    send: async (command: Command) => {
      if (command instanceof QueryCommand && !command.input.IndexName) {
        keyCondition = command.input.KeyConditionExpression;
      }
      return { Items: [] };
    },
  } as unknown as DynamoDBDocumentClient;

  const repository = new DynamoDbAwsAccountRepository(
    client,
    'sisum-aws-accounts-test',
  );

  await repository.listByTenant('tenant-a');

  assert.match(keyCondition ?? '', /begins_with\(#sk, :accountPrefix\)/);
});

test('transitionStatus from VALIDATING to PENDING records validation failure timestamp', async () => {
  const input = createInput();
  const priorLastValidated = '2026-01-01T00:00:00.000Z';

  const client = {
    send: async (command: Command) => {
      if (command instanceof GetCommand) {
        return {
          Item: {
            ...input,
            status: 'VALIDATING',
            verificationStatus: 'IN_PROGRESS',
            lastValidated: priorLastValidated,
            pk: tenantPartitionKey('tenant-a'),
            sk: awsAccountSortKey('123456789012'),
            entityType: 'AWS_ACCOUNT',
            gsi1pk: awsAccountGlobalIndexPartitionKey('123456789012'),
            gsi1sk: tenantPartitionKey('tenant-a'),
            gsi2pk: awsAccountStatusIndexPartitionKey('tenant-a', 'VALIDATING'),
            gsi2sk:
              'UPDATED_AT#2026-07-30T00:00:00.000Z#AWS_ACCOUNT#123456789012',
            version: 2,
            createdAt: '2026-07-30T00:00:00.000Z',
            updatedAt: '2026-07-30T00:00:00.000Z',
          },
        };
      }

      if (command instanceof UpdateCommand) {
        const attrs = {
          ...input,
          status: 'PENDING',
          verificationStatus: 'FAILED',
          lastValidated: '2026-07-30T12:00:00.000Z',
          pk: tenantPartitionKey('tenant-a'),
          sk: awsAccountSortKey('123456789012'),
          entityType: 'AWS_ACCOUNT',
          gsi1pk: awsAccountGlobalIndexPartitionKey('123456789012'),
          gsi1sk: tenantPartitionKey('tenant-a'),
          gsi2pk: awsAccountStatusIndexPartitionKey('tenant-a', 'PENDING'),
          gsi2sk:
            'UPDATED_AT#2026-07-30T12:00:00.000Z#AWS_ACCOUNT#123456789012',
          version: 3,
          createdAt: '2026-07-30T00:00:00.000Z',
          updatedAt: '2026-07-30T12:00:00.000Z',
        };
        return { Attributes: attrs };
      }

      return {};
    },
  } as unknown as DynamoDBDocumentClient;

  const repository = new DynamoDbAwsAccountRepository(
    client,
    'sisum-aws-accounts-test',
  );

  const result = await repository.transitionStatus(
    'tenant-a',
    '123456789012',
    'PENDING',
    { expectedVersion: 2 },
  );

  assert.equal(result.verificationStatus, 'FAILED');
  assert.ok(result.lastValidated);
  assert.notEqual(result.lastValidated, priorLastValidated);
});
