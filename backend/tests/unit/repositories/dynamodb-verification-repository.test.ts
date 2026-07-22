import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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
  encodeNextToken,
} from '../../../database';

import { DynamoDbVerificationRepository } from '../../../repositories/dynamodb/dynamodb-verification-repository';

interface FakeClient {
  commands: unknown[];
  response: unknown;
  error?: Error;
  send(command: unknown): Promise<unknown>;
}

function createFakeClient(
  response: unknown = {},
  error?: Error,
): FakeClient {
  return {
    commands: [],
    response,
    error,

    async send(command: unknown): Promise<unknown> {
      this.commands.push(command);

      if (this.error) {
        throw this.error;
      }

      return this.response;
    },
  };
}

function conditionalFailure(): Error {
  const error = new Error('Conditional check failed.');
  error.name = 'ConditionalCheckFailedException';

  return error;
}

describe('DynamoDbVerificationRepository', () => {
  it('creates a verification record conditionally', async () => {
    const fakeClient = createFakeClient();

    const repository =
      new DynamoDbVerificationRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'verification-table',
      );

    const result = await repository.create({
      tenantId: 'tenant-a',
      verificationId: 'verification-123',
      workflowId: 'wf-123',
      outcome: 'PASSED',
    });

    assert.equal(result.version, 1);

    const command = fakeClient.commands[0];

    assert.ok(command instanceof PutCommand);

    assert.equal(
      command.input.ConditionExpression,
      'attribute_not_exists(pk) AND attribute_not_exists(sk)',
    );

    assert.equal(
      command.input.Item?.pk,
      'TENANT#tenant-a',
    );

    assert.equal(
      command.input.Item?.sk,
      'VERIFICATION#verification-123',
    );

    assert.equal(
      command.input.Item?.gsi1pk,
      'TENANT#tenant-a#WORKFLOW#wf-123',
    );
  });

  it('supports verification records without workflowId', async () => {
    const fakeClient = createFakeClient();

    const repository =
      new DynamoDbVerificationRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'verification-table',
      );

    await repository.create({
      tenantId: 'tenant-a',
      verificationId: 'verification-123',
      outcome: 'PASSED',
    });

    const command = fakeClient.commands[0];

    assert.ok(command instanceof PutCommand);
    assert.equal(command.input.Item?.gsi1pk, undefined);
  });

  it('rejects duplicate verification records', async () => {
    const fakeClient = createFakeClient(
      {},
      conditionalFailure(),
    );

    const repository =
      new DynamoDbVerificationRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'verification-table',
      );

    await assert.rejects(
      () =>
        repository.create({
          tenantId: 'tenant-a',
          verificationId: 'verification-123',
          workflowId: 'wf-123',
          outcome: 'PASSED',
        }),
      RepositoryAlreadyExistsError,
    );
  });

  it('gets a verification record using tenant keys', async () => {
    const fakeClient = createFakeClient({
      Item: {
        pk: 'TENANT#tenant-a',
        sk: 'VERIFICATION#verification-123',
        entityType: 'VERIFICATION',
        tenantId: 'tenant-a',
        verificationId: 'verification-123',
        workflowId: 'wf-123',
        outcome: 'PASSED',
        version: 1,
        createdAt: '2026-07-22T10:00:00.000Z',
        updatedAt: '2026-07-22T10:00:00.000Z',
        gsi1pk: 'TENANT#tenant-a#WORKFLOW#wf-123',
        gsi1sk:
          'CREATED_AT#2026-07-22T10:00:00.000Z#VERIFICATION#verification-123',
      },
    });

    const repository =
      new DynamoDbVerificationRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'verification-table',
      );

    const result = await repository.get(
      'tenant-a',
      'verification-123',
    );

    assert.equal(
      result?.verificationId,
      'verification-123',
    );

    const command = fakeClient.commands[0];

    assert.ok(command instanceof GetCommand);

    assert.equal(
      command.input.Key?.pk,
      'TENANT#tenant-a',
    );

    assert.equal(
      command.input.Key?.sk,
      'VERIFICATION#verification-123',
    );
  });

  it('returns undefined when the record is missing', async () => {
    const fakeClient = createFakeClient({});

    const repository =
      new DynamoDbVerificationRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'verification-table',
      );

    const result = await repository.get(
      'tenant-a',
      'missing',
    );

    assert.equal(result, undefined);
  });

  it('updates with optimistic locking', async () => {
    const fakeClient = createFakeClient({
      Attributes: {
        pk: 'TENANT#tenant-a',
        sk: 'VERIFICATION#verification-123',
        entityType: 'VERIFICATION',
        tenantId: 'tenant-a',
        verificationId: 'verification-123',
        workflowId: 'wf-123',
        outcome: 'FAILED',
        version: 2,
        createdAt: '2026-07-22T10:00:00.000Z',
        updatedAt: '2026-07-22T11:00:00.000Z',
        gsi1pk: 'TENANT#tenant-a#WORKFLOW#wf-123',
        gsi1sk:
          'CREATED_AT#2026-07-22T10:00:00.000Z#VERIFICATION#verification-123',
      },
    });

    const repository =
      new DynamoDbVerificationRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'verification-table',
      );

    const result = await repository.update(
      'tenant-a',
      'verification-123',
      {
        outcome: 'FAILED',
      },
      {
        expectedVersion: 1,
      },
    );

    assert.equal(result.version, 2);

    const command = fakeClient.commands[0];

    assert.ok(command instanceof UpdateCommand);

    assert.equal(
      command.input.ExpressionAttributeValues?.[
        ':expectedVersion'
      ],
      1,
    );
  });

  it('reports optimistic-lock conflicts', async () => {
    const fakeClient = createFakeClient(
      {},
      conditionalFailure(),
    );

    const repository =
      new DynamoDbVerificationRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'verification-table',
      );

    await assert.rejects(
      () =>
        repository.update(
          'tenant-a',
          'verification-123',
          {
            outcome: 'FAILED',
          },
          {
            expectedVersion: 1,
          },
        ),
      RepositoryConflictError,
    );
  });

  it('deletes with tenant-scoped keys', async () => {
    const fakeClient = createFakeClient({});

    const repository =
      new DynamoDbVerificationRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'verification-table',
      );

    await repository.delete(
      'tenant-a',
      'verification-123',
      {
        expectedVersion: 2,
      },
    );

    const command = fakeClient.commands[0];

    assert.ok(command instanceof DeleteCommand);

    assert.equal(
      command.input.Key?.pk,
      'TENANT#tenant-a',
    );

    assert.equal(
      command.input.Key?.sk,
      'VERIFICATION#verification-123',
    );
  });

  it('lists tenant records using QueryCommand', async () => {
    const lastEvaluatedKey = {
      pk: 'TENANT#tenant-a',
      sk: 'VERIFICATION#verification-123',
    };

    const fakeClient = createFakeClient({
      Items: [],
      LastEvaluatedKey: lastEvaluatedKey,
    });

    const repository =
      new DynamoDbVerificationRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'verification-table',
      );

    const result = await repository.listByTenant(
      'tenant-a',
      {
        limit: 10,
      },
    );

    const command = fakeClient.commands[0];

    assert.ok(command instanceof QueryCommand);
    assert.equal(command.input.Limit, 10);

    assert.equal(
      result.nextToken,
      encodeNextToken(lastEvaluatedKey),
    );
  });

  it('lists by workflow using gsi1', async () => {
    const fakeClient = createFakeClient({
      Items: [],
    });

    const repository =
      new DynamoDbVerificationRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'verification-table',
      );

    await repository.listByWorkflow(
      'tenant-a',
      'wf-123',
    );

    const command = fakeClient.commands[0];

    assert.ok(command instanceof QueryCommand);
    assert.equal(command.input.IndexName, 'gsi1');

    assert.equal(
      command.input.ExpressionAttributeValues?.[
        ':gsi1pk'
      ],
      'TENANT#tenant-a#WORKFLOW#wf-123',
    );
  });
});