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

import {
  DynamoDbWorkflowRepository,
} from '../../../repositories/dynamodb/dynamodb-workflow-repository';

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
  const error = new Error(
    'Conditional check failed.',
  );

  error.name = 'ConditionalCheckFailedException';

  return error;
}

describe('DynamoDbWorkflowRepository', () => {
  it('creates a workflow with a conditional PutCommand', async () => {
    const fakeClient = createFakeClient();

    const repository =
      new DynamoDbWorkflowRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'workflow-table',
      );

    const result = await repository.create({
      tenantId: 'tenant-a',
      workflowId: 'wf-123',
      status: 'PENDING',
      provider: 'mock',
    });

    assert.equal(result.version, 1);
    assert.equal(result.tenantId, 'tenant-a');

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
      'WORKFLOW#wf-123',
    );
  });

  it('rejects duplicate workflow creation', async () => {
    const fakeClient = createFakeClient(
      {},
      conditionalFailure(),
    );

    const repository =
      new DynamoDbWorkflowRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'workflow-table',
      );

    await assert.rejects(
      () =>
        repository.create({
          tenantId: 'tenant-a',
          workflowId: 'wf-123',
          status: 'PENDING',
          provider: 'mock',
        }),
      RepositoryAlreadyExistsError,
    );
  });

  it('gets a workflow using tenant-scoped keys', async () => {
    const fakeClient = createFakeClient({
      Item: {
        pk: 'TENANT#tenant-a',
        sk: 'WORKFLOW#wf-123',
        entityType: 'WORKFLOW',
        tenantId: 'tenant-a',
        workflowId: 'wf-123',
        status: 'PENDING',
        provider: 'mock',
        version: 1,
        createdAt: '2026-07-22T10:00:00.000Z',
        updatedAt: '2026-07-22T10:00:00.000Z',
        gsi1pk:
          'TENANT#tenant-a#WORKFLOW_STATUS#PENDING',
        gsi1sk:
          'CREATED_AT#2026-07-22T10:00:00.000Z#WORKFLOW#wf-123',
      },
    });

    const repository =
      new DynamoDbWorkflowRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'workflow-table',
      );

    const result = await repository.get(
      'tenant-a',
      'wf-123',
    );

    assert.equal(result?.workflowId, 'wf-123');

    const command = fakeClient.commands[0];

    assert.ok(command instanceof GetCommand);
    assert.equal(
      command.input.Key?.pk,
      'TENANT#tenant-a',
    );
    assert.equal(
      command.input.Key?.sk,
      'WORKFLOW#wf-123',
    );
  });

  it('returns undefined when a workflow is missing', async () => {
    const fakeClient = createFakeClient({});

    const repository =
      new DynamoDbWorkflowRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'workflow-table',
      );

    const result = await repository.get(
      'tenant-a',
      'missing',
    );

    assert.equal(result, undefined);
  });

  it('updates using optimistic locking', async () => {
    const fakeClient = createFakeClient({
      Attributes: {
        pk: 'TENANT#tenant-a',
        sk: 'WORKFLOW#wf-123',
        entityType: 'WORKFLOW',
        tenantId: 'tenant-a',
        workflowId: 'wf-123',
        status: 'COMPLETED',
        provider: 'mock',
        version: 2,
        createdAt: '2026-07-22T10:00:00.000Z',
        updatedAt: '2026-07-22T11:00:00.000Z',
        gsi1pk:
          'TENANT#tenant-a#WORKFLOW_STATUS#COMPLETED',
        gsi1sk:
          'CREATED_AT#2026-07-22T10:00:00.000Z#WORKFLOW#wf-123',
      },
    });

    const repository =
      new DynamoDbWorkflowRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'workflow-table',
      );

    const result = await repository.update(
      'tenant-a',
      'wf-123',
      {
        status: 'COMPLETED',
      },
      {
        expectedVersion: 1,
      },
    );

    assert.equal(result.version, 2);

    const command = fakeClient.commands[0];

    assert.ok(command instanceof UpdateCommand);

    assert.equal(
      command.input.ConditionExpression,
      'attribute_exists(pk) AND #version = :expectedVersion',
    );

    assert.equal(
      command.input.ExpressionAttributeValues?.[
        ':expectedVersion'
      ],
      1,
    );
  });

  it('reports a stale-version conflict', async () => {
    const fakeClient = createFakeClient(
      {},
      conditionalFailure(),
    );

    const repository =
      new DynamoDbWorkflowRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'workflow-table',
      );

    await assert.rejects(
      () =>
        repository.update(
          'tenant-a',
          'wf-123',
          {
            status: 'FAILED',
          },
          {
            expectedVersion: 1,
          },
        ),
      RepositoryConflictError,
    );
  });

  it('deletes using tenant-scoped keys', async () => {
    const fakeClient = createFakeClient({});

    const repository =
      new DynamoDbWorkflowRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'workflow-table',
      );

    await repository.delete(
      'tenant-a',
      'wf-123',
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
      command.input.ExpressionAttributeValues?.[
        ':expectedVersion'
      ],
      2,
    );
  });

  it('lists workflows using QueryCommand', async () => {
    const lastEvaluatedKey = {
      pk: 'TENANT#tenant-a',
      sk: 'WORKFLOW#wf-123',
    };

    const fakeClient = createFakeClient({
      Items: [],
      LastEvaluatedKey: lastEvaluatedKey,
    });

    const repository =
      new DynamoDbWorkflowRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'workflow-table',
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

  it('lists workflows by status using the GSI', async () => {
    const fakeClient = createFakeClient({
      Items: [],
    });

    const repository =
      new DynamoDbWorkflowRepository(
        fakeClient as unknown as DynamoDBDocumentClient,
        'workflow-table',
      );

    await repository.listByStatus(
      'tenant-a',
      'COMPLETED',
    );

    const command = fakeClient.commands[0];

    assert.ok(command instanceof QueryCommand);
    assert.equal(command.input.IndexName, 'gsi1');
    assert.equal(
      command.input.ExpressionAttributeValues?.[
        ':gsi1pk'
      ],
      'TENANT#tenant-a#WORKFLOW_STATUS#COMPLETED',
    );
  });
});