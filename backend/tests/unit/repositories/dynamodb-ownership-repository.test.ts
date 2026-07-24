import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
} from '../../../database';

import { DynamoDbOwnershipRepository } from '../../../repositories/dynamodb/dynamodb-ownership-repository';

interface FakeClient {
  commands: unknown[];
  response: unknown;
  putError?: Error;
  deleteError?: Error;
  send(command: unknown): Promise<unknown>;
}

function createFakeClient(
  response: unknown = {},
  error?: Error,
  errorCommand: 'put' | 'delete' | 'any' = 'any',
): FakeClient {
  return {
    commands: [],
    response,
    putError: errorCommand === 'put' || errorCommand === 'any' ? error : undefined,
    deleteError: errorCommand === 'delete' || errorCommand === 'any' ? error : undefined,

    async send(command: unknown): Promise<unknown> {
      this.commands.push(command);

      if (this.putError && command instanceof PutCommand) {
        throw this.putError;
      }

      if (this.deleteError && command instanceof DeleteCommand) {
        throw this.deleteError;
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

describe('DynamoDbOwnershipRepository', () => {
  it('creates an ownership record conditionally', async () => {
    const fakeClient = createFakeClient();

    const repository =
      new DynamoDbOwnershipRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'ownership-table',
      );

    const result = await repository.create({
      resourceType: 'WORKFLOW',
      resourceId: 'wf-123',
      ownerTenantId: 'tenant-a',
    });

    assert.equal(result.version, 1);

    const command = fakeClient.commands[0];

    assert.ok(command instanceof PutCommand);

    assert.equal(
      command.input.ConditionExpression,
      'attribute_not_exists(pk) OR ownerTenantId = :owner OR tenantId = :owner',
    );

    assert.equal(
      command.input.Item?.pk,
      'RESOURCE#WORKFLOW#wf-123',
    );

    assert.equal(
      command.input.Item?.sk,
      'OWNERSHIP',
    );

    assert.equal(
      command.input.Item?.ownerTenantId,
      'tenant-a',
    );
  });

  it('rejects duplicate ownership records for a different tenant', async () => {
    const fakeClient = createFakeClient(
      {
        Item: {
          pk: 'RESOURCE#WORKFLOW#wf-123',
          sk: 'OWNERSHIP',
          entityType: 'OWNERSHIP',
          resourceType: 'WORKFLOW',
          resourceId: 'wf-123',
          ownerTenantId: 'tenant-b',
          version: 1,
          createdAt: '2026-07-22T10:00:00.000Z',
          updatedAt: '2026-07-22T10:00:00.000Z',
        },
      },
      conditionalFailure(),
      'put',
    );

    const repository =
      new DynamoDbOwnershipRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'ownership-table',
      );

    await assert.rejects(
      () =>
        repository.create({
          resourceType: 'WORKFLOW',
          resourceId: 'wf-123',
          ownerTenantId: 'tenant-a',
        }),
      RepositoryAlreadyExistsError,
    );
  });

  it('returns existing ownership for same-tenant replay', async () => {
    const existing = {
      pk: 'RESOURCE#WORKFLOW#wf-123',
      sk: 'OWNERSHIP',
      entityType: 'OWNERSHIP',
      resourceType: 'WORKFLOW' as const,
      resourceId: 'wf-123',
      ownerTenantId: 'tenant-a',
      version: 1,
      createdAt: '2026-07-22T10:00:00.000Z',
      updatedAt: '2026-07-22T10:00:00.000Z',
    };

    const fakeClient = createFakeClient(
      { Item: existing },
      conditionalFailure(),
      'put',
    );

    const repository =
      new DynamoDbOwnershipRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'ownership-table',
      );

    const result = await repository.create({
      resourceType: 'WORKFLOW',
      resourceId: 'wf-123',
      ownerTenantId: 'tenant-a',
    });

    assert.equal(result.ownerTenantId, 'tenant-a');
  });

  it('gets ownership using resource-scoped keys', async () => {
    const fakeClient = createFakeClient({
      Item: {
        pk: 'RESOURCE#WORKFLOW#wf-123',
        sk: 'OWNERSHIP',
        entityType: 'OWNERSHIP',
        resourceType: 'WORKFLOW',
        resourceId: 'wf-123',
        ownerTenantId: 'tenant-a',
        version: 1,
        createdAt: '2026-07-22T10:00:00.000Z',
        updatedAt: '2026-07-22T10:00:00.000Z',
      },
    });

    const repository =
      new DynamoDbOwnershipRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'ownership-table',
      );

    const result = await repository.get(
      'WORKFLOW',
      'wf-123',
    );

    assert.equal(result?.ownerTenantId, 'tenant-a');

    const command = fakeClient.commands[0];

    assert.ok(command instanceof GetCommand);

    assert.equal(
      command.input.Key?.pk,
      'RESOURCE#WORKFLOW#wf-123',
    );

    assert.equal(
      command.input.Key?.sk,
      'OWNERSHIP',
    );

    assert.equal(command.input.ConsistentRead, true);
  });

  it('returns undefined when ownership is missing', async () => {
    const fakeClient = createFakeClient({});

    const repository =
      new DynamoDbOwnershipRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'ownership-table',
      );

    const result = await repository.get(
      'WORKFLOW',
      'missing',
    );

    assert.equal(result, undefined);
  });

  it('deletes with an expected version', async () => {
    const fakeClient = createFakeClient({});

    const repository =
      new DynamoDbOwnershipRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'ownership-table',
      );

    await repository.delete(
      'WORKFLOW',
      'wf-123',
      2,
    );

    const command = fakeClient.commands[0];

    assert.ok(command instanceof DeleteCommand);

    assert.equal(
      command.input.Key?.pk,
      'RESOURCE#WORKFLOW#wf-123',
    );

    assert.equal(
      command.input.ExpressionAttributeValues?.[
        ':expectedVersion'
      ],
      2,
    );

    assert.equal(
      command.input.ConditionExpression,
      'attribute_exists(pk) AND #version = :expectedVersion',
    );
  });

  it('supports deletion without an expected version', async () => {
    const fakeClient = createFakeClient({});

    const repository =
      new DynamoDbOwnershipRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'ownership-table',
      );

    await repository.delete(
      'REPORT',
      'report-123',
    );

    const command = fakeClient.commands[0];

    assert.ok(command instanceof DeleteCommand);

    assert.equal(
      command.input.ConditionExpression,
      'attribute_exists(pk)',
    );
  });

  it('reports deletion conflicts', async () => {
    const fakeClient = createFakeClient(
      {},
      conditionalFailure(),
      'delete',
    );

    const repository =
      new DynamoDbOwnershipRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'ownership-table',
      );

    await assert.rejects(
      () =>
        repository.delete(
          'WORKFLOW',
          'wf-123',
          1,
        ),
      RepositoryConflictError,
    );
  });

  it('rejects an invalid expected version', async () => {
    const fakeClient = createFakeClient();

    const repository =
      new DynamoDbOwnershipRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'ownership-table',
      );

    await assert.rejects(
      () =>
        repository.delete(
          'WORKFLOW',
          'wf-123',
          0,
        ),
      /expectedVersion must be a positive integer/,
    );

    assert.equal(fakeClient.commands.length, 0);
  });
});