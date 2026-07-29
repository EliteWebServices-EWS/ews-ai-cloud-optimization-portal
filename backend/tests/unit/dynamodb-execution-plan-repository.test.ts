import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
} from '../../database';

import { DynamoDbExecutionPlanRepository } from '../../repositories/dynamodb/dynamodb-execution-plan-repository';
import type { CreateExecutionPlanInput } from '../../repositories/contracts';
import { initialApprovalStatus } from '../../repositories/contracts/execution-plan-repository';

type Command =
  | GetCommand
  | PutCommand
  | QueryCommand
  | UpdateCommand;

function createInput(): CreateExecutionPlanInput {
  return {
    executionId: 'exec-1',
    tenantId: 'tenant-1',
    workflowId: 'wf-1',
    recommendationId: 'rec-1',
    planStatus: 'DRAFT',
    createdBy: 'user-1',
    executionSteps: [
      {
        stepId: 'step-1',
        order: 0,
        actionType: 'RESIZE',
        resourceType: 'EC2',
        resourceId: 'i-123',
        description: 'Resize',
      },
    ],
    rollbackPlan: {
      strategy: 'REVERSE',
      steps: [],
      automatic: false,
    },
    riskLevel: 'LOW',
    approvalRequired: false,
    approvalStatus: initialApprovalStatus(false),
  };
}

test('create uses conditional put and duplicate becomes RepositoryAlreadyExistsError', async () => {
  let putCount = 0;

  const client = {
    send: async (command: Command) => {
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

  const repository = new DynamoDbExecutionPlanRepository(
    client,
    'sisum-execution-plans-test',
  );

  await repository.create(createInput());

  await assert.rejects(
    () => repository.create(createInput()),
    RepositoryAlreadyExistsError,
  );
});

test('concurrent updates produce one conflict', async () => {
  const stored = {
    version: 1,
    updatedAt: '2026-07-29T10:00:00.000Z',
  };

  let updateAttempts = 0;

  const client = {
    send: async (command: Command) => {
      if (command instanceof GetCommand) {
        return {
          Item: {
            ...createInput(),
            ...stored,
            pk: 'TENANT#tenant-1',
            sk: 'EXECUTION#exec-1',
            entityType: 'EXECUTION_PLAN',
            gsi1pk: 'TENANT#tenant-1#WORKFLOW#wf-1',
            gsi1sk: 'CREATED_AT#2026-07-29T10:00:00.000Z#EXECUTION#exec-1',
            gsi2pk: 'TENANT#tenant-1#EXECUTION_STATUS#DRAFT',
            gsi2sk: 'CREATED_AT#2026-07-29T10:00:00.000Z#EXECUTION#exec-1',
            createdAt: '2026-07-29T10:00:00.000Z',
          },
        };
      }

      if (command instanceof UpdateCommand) {
        updateAttempts += 1;
        if (updateAttempts > 1) {
          const error = new Error('ConditionalCheckFailedException');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }

        stored.version = 2;
        stored.updatedAt = '2026-07-29T10:00:01.000Z';

        return {
          Attributes: {
            ...createInput(),
            ...stored,
            pk: 'TENANT#tenant-1',
            sk: 'EXECUTION#exec-1',
            entityType: 'EXECUTION_PLAN',
            gsi1pk: 'TENANT#tenant-1#WORKFLOW#wf-1',
            gsi1sk: 'CREATED_AT#2026-07-29T10:00:00.000Z#EXECUTION#exec-1',
            gsi2pk: 'TENANT#tenant-1#EXECUTION_STATUS#DRAFT',
            gsi2sk: 'CREATED_AT#2026-07-29T10:00:00.000Z#EXECUTION#exec-1',
            createdAt: '2026-07-29T10:00:00.000Z',
          },
        };
      }

      return {};
    },
  } as unknown as DynamoDBDocumentClient;

  const repository = new DynamoDbExecutionPlanRepository(
    client,
    'sisum-execution-plans-test',
  );

  const [first, second] = await Promise.allSettled([
    repository.update(
      'tenant-1',
      'exec-1',
      { metadata: { attempt: 1 } },
      { expectedVersion: 1 },
    ),
    repository.update(
      'tenant-1',
      'exec-1',
      { metadata: { attempt: 2 } },
      { expectedVersion: 1 },
    ),
  ]);

  assert.equal(
    [first, second].filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    [first, second].filter(
      (result) =>
        result.status === 'rejected' &&
        result.reason instanceof RepositoryConflictError,
    ).length,
    1,
  );
});

test('listByTenant uses QueryCommand not Scan', async () => {
  let sawQuery = false;

  const client = {
    send: async (command: Command) => {
      if (command instanceof QueryCommand) {
        sawQuery = true;
      }
      return { Items: [] };
    },
  } as unknown as DynamoDBDocumentClient;

  const repository = new DynamoDbExecutionPlanRepository(
    client,
    'sisum-execution-plans-test',
  );

  await repository.listByTenant('tenant-1');
  assert.equal(sawQuery, true);
});
