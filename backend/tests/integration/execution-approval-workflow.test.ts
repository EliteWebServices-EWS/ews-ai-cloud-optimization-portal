import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  RepositoryConflictError,
  RepositoryNotFoundError,
} from '../../database';
import { initialApprovalStatus } from '../../repositories/contracts/execution-plan-repository';
import { InvalidExecutionTransitionError } from '../../services/execution-lifecycle';

import {
  buildPlanInput,
  createInMemoryExecutionStores,
  TENANT_A,
  TENANT_B,
} from './execution/fixtures';

describe('Execution approval workflow integration', () => {
  it('creates plan with pending approval and records approval decision', async () => {
    const { plans } = createInMemoryExecutionStores();
    const created = await plans.create(
      buildPlanInput({
        executionId: 'exec-approve-1',
        approvalRequired: true,
        approvalStatus: initialApprovalStatus(true),
      }),
    );

    assert.equal(created.approvalStatus, 'PENDING');

    const pending = await plans.transitionStatus(
      TENANT_A,
      created.executionId,
      'PENDING_APPROVAL',
      { expectedVersion: created.version },
    );

    const approved = await plans.recordApprovalDecision(
      TENANT_A,
      pending.executionId,
      { decision: 'APPROVED', actorId: 'approver-1' },
      { expectedVersion: pending.version },
    );

    assert.equal(approved.planStatus, 'APPROVED');
    assert.equal(approved.approvalStatus, 'APPROVED');
    assert.equal(approved.approvedBy, 'approver-1');
  });

  it('rejects execution start when approval is required but missing', async () => {
    const { plans } = createInMemoryExecutionStores();
    const created = await plans.create(
      buildPlanInput({
        executionId: 'exec-no-approve',
        approvalRequired: true,
        approvalStatus: initialApprovalStatus(true),
      }),
    );

    await assert.rejects(
      () =>
        plans.transitionStatus(
          TENANT_A,
          created.executionId,
          'EXECUTING',
          { expectedVersion: created.version },
        ),
      InvalidExecutionTransitionError,
    );

    const pending = await plans.transitionStatus(
      TENANT_A,
      created.executionId,
      'PENDING_APPROVAL',
      { expectedVersion: created.version },
    );

    await assert.rejects(
      () =>
        plans.transitionStatus(
          TENANT_A,
          pending.executionId,
          'EXECUTING',
          { expectedVersion: pending.version },
        ),
      InvalidExecutionTransitionError,
    );
  });

  it('rejects approval on wrong tenant (not found)', async () => {
    const { plans } = createInMemoryExecutionStores();
    const created = await plans.create(
      buildPlanInput({
        executionId: 'exec-tenant-approve',
        approvalRequired: true,
        approvalStatus: initialApprovalStatus(true),
      }),
    );

    const pending = await plans.transitionStatus(
      TENANT_A,
      created.executionId,
      'PENDING_APPROVAL',
      { expectedVersion: created.version },
    );

    await assert.rejects(
      () =>
        plans.recordApprovalDecision(
          TENANT_B,
          pending.executionId,
          { decision: 'APPROVED', actorId: 'approver-x' },
          { expectedVersion: pending.version },
        ),
      RepositoryNotFoundError,
    );
  });

  it('rejected plan cannot transition to executing', async () => {
    const { plans } = createInMemoryExecutionStores();
    const created = await plans.create(
      buildPlanInput({
        executionId: 'exec-reject',
        approvalRequired: true,
        approvalStatus: initialApprovalStatus(true),
      }),
    );

    const pending = await plans.transitionStatus(
      TENANT_A,
      created.executionId,
      'PENDING_APPROVAL',
      { expectedVersion: created.version },
    );

    const rejected = await plans.recordApprovalDecision(
      TENANT_A,
      pending.executionId,
      { decision: 'REJECTED', actorId: 'approver-1', rejectionReason: 'no' },
      { expectedVersion: pending.version },
    );

    assert.equal(rejected.planStatus, 'REJECTED');

    await assert.rejects(
      () =>
        plans.transitionStatus(
          TENANT_A,
          rejected.executionId,
          'EXECUTING',
          { expectedVersion: rejected.version },
        ),
      InvalidExecutionTransitionError,
    );
  });

  it('rejects stale approval update', async () => {
    const { plans } = createInMemoryExecutionStores();
    const created = await plans.create(
      buildPlanInput({
        executionId: 'exec-stale-approval',
        approvalRequired: true,
        approvalStatus: initialApprovalStatus(true),
      }),
    );

    const pending = await plans.transitionStatus(
      TENANT_A,
      created.executionId,
      'PENDING_APPROVAL',
      { expectedVersion: created.version },
    );

    await assert.rejects(
      () =>
        plans.recordApprovalDecision(
          TENANT_A,
          pending.executionId,
          { decision: 'APPROVED', actorId: 'approver-1' },
          { expectedVersion: 1 },
        ),
      RepositoryConflictError,
    );
  });
});
