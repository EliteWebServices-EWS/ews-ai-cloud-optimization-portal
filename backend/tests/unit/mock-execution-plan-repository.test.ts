import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  InvalidPaginationTokenError,
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
} from '../../database';

import { MockExecutionPlanRepository } from '../../repositories/mock/mock-execution-plan-repository';
import type { CreateExecutionPlanInput } from '../../repositories/contracts';
import { initialApprovalStatus } from '../../repositories/contracts/execution-plan-repository';

function createInput(
  overrides: Partial<CreateExecutionPlanInput> = {},
): CreateExecutionPlanInput {
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
    ...overrides,
  };
}

test('create begins with version 1 and timestamps', async () => {
  const repository = new MockExecutionPlanRepository();
  const created = await repository.create(createInput());

  assert.equal(created.version, 1);
  assert.ok(created.createdAt);
  assert.ok(created.updatedAt);
});

test('duplicate executionId in same tenant is rejected', async () => {
  const repository = new MockExecutionPlanRepository();
  await repository.create(createInput());

  await assert.rejects(
    () => repository.create(createInput()),
    RepositoryAlreadyExistsError,
  );
});

test('same executionId is allowed in another tenant', async () => {
  const repository = new MockExecutionPlanRepository();
  await repository.create(createInput());
  await repository.create(createInput({ tenantId: 'tenant-2' }));

  assert.ok(await repository.getById('tenant-2', 'exec-1'));
});

test('cross-tenant get does not return record', async () => {
  const repository = new MockExecutionPlanRepository();
  await repository.create(createInput());

  assert.equal(await repository.getById('tenant-2', 'exec-1'), undefined);
});

test('optimistic locking and concurrency', async () => {
  const repository = new MockExecutionPlanRepository();
  const created = await repository.create(createInput());

  const [first, second] = await Promise.allSettled([
    repository.update(
      created.tenantId,
      created.executionId,
      { metadata: { attempt: 1 } },
      { expectedVersion: created.version },
    ),
    repository.update(
      created.tenantId,
      created.executionId,
      { metadata: { attempt: 2 } },
      { expectedVersion: created.version },
    ),
  ]);

  const fulfilled = [first, second].filter(
    (result) => result.status === 'fulfilled',
  );
  const rejected = [first, second].filter(
    (result) => result.status === 'rejected',
  );

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0]?.reason instanceof RepositoryConflictError);

  const latest = await repository.getById(
    created.tenantId,
    created.executionId,
  );
  assert.equal(latest?.version, 2);
});

describe('approval paths through repository', () => {
  test('approvalRequired=true: DRAFT -> PENDING_APPROVAL -> APPROVED', async () => {
    const repository = new MockExecutionPlanRepository();
    const created = await repository.create(
      createInput({
        approvalRequired: true,
        approvalStatus: initialApprovalStatus(true),
      }),
    );

    assert.equal(created.planStatus, 'DRAFT');

    const pending = await repository.transitionStatus(
      created.tenantId,
      created.executionId,
      'PENDING_APPROVAL',
      { expectedVersion: created.version },
    );
    assert.equal(pending.planStatus, 'PENDING_APPROVAL');

    const approved = await repository.recordApprovalDecision(
      pending.tenantId,
      pending.executionId,
      { decision: 'APPROVED', actorId: 'approver-1' },
      { expectedVersion: pending.version },
    );
    assert.equal(approved.planStatus, 'APPROVED');
    assert.equal(approved.approvalStatus, 'APPROVED');
    assert.equal(approved.approvedBy, 'approver-1');
    assert.ok(approved.approvedAt);
  });

  test('approvalRequired=false: DRAFT -> APPROVED', async () => {
    const repository = new MockExecutionPlanRepository();
    const created = await repository.create(createInput());

    assert.equal(created.approvalRequired, false);
    assert.equal(created.approvalStatus, 'NOT_REQUIRED');

    const approved = await repository.transitionStatus(
      created.tenantId,
      created.executionId,
      'APPROVED',
      { expectedVersion: created.version },
    );
    assert.equal(approved.planStatus, 'APPROVED');
    assert.equal(approved.approvalStatus, 'NOT_REQUIRED');
  });
});

test('pagination tokens are scoped to query type', async () => {
  const repository = new MockExecutionPlanRepository();
  await repository.create(
    createInput({ executionId: 'exec-a', workflowId: 'wf-a' }),
  );
  await repository.create(
    createInput({ executionId: 'exec-a2', workflowId: 'wf-a' }),
  );

  const workflowPage = await repository.listByWorkflow('tenant-1', 'wf-a', {
    limit: 1,
  });

  assert.ok(workflowPage.nextToken);

  await assert.rejects(
    () =>
      repository.listByStatus('tenant-1', 'DRAFT', {
        nextToken: workflowPage.nextToken,
      }),
    InvalidPaginationTokenError,
  );
});
