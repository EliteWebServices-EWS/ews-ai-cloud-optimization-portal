import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InvalidPaginationTokenError,
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  RepositoryNotFoundError,
} from '../../database';
import { initialApprovalStatus } from '../../repositories/contracts/execution-plan-repository';

import {
  buildPlanInput,
  createInMemoryExecutionStores,
  TENANT_A,
  TENANT_B,
} from './execution/fixtures';

describe('Execution plan CRUD integration', () => {
  it('creates, retrieves, updates, and lists tenant-scoped plans', async () => {
    const { plans } = createInMemoryExecutionStores();
    const input = buildPlanInput({ executionId: 'exec-crud-1' });
    const created = await plans.create(input);

    assert.equal(created.tenantId, TENANT_A);
    assert.equal(created.version, 1);

    const fetched = await plans.getById(TENANT_A, 'exec-crud-1');
    assert.ok(fetched);
    assert.equal(fetched?.planStatus, 'DRAFT');

    const updated = await plans.update(
      TENANT_A,
      'exec-crud-1',
      { metadata: { note: 'updated' } },
      { expectedVersion: created.version },
    );
    assert.equal(updated.version, 2);
    assert.equal(updated.metadata?.note, 'updated');

    const list = await plans.listByTenant(TENANT_A);
    assert.equal(list.items.length, 1);
  });

  it('paginates plans without duplicates across pages', async () => {
    const { plans } = createInMemoryExecutionStores();
    for (let index = 0; index < 5; index += 1) {
      await plans.create(
        buildPlanInput({
          executionId: `exec-page-${index}`,
          workflowId: 'wf-page',
        }),
      );
    }

    const first = await plans.listByTenant(TENANT_A, { limit: 2 });
    assert.equal(first.items.length, 2);
    assert.ok(first.nextToken);

    const second = await plans.listByTenant(TENANT_A, {
      limit: 2,
      nextToken: first.nextToken,
    });

    const ids = new Set([
      ...first.items.map((item) => item.executionId),
      ...second.items.map((item) => item.executionId),
    ]);
    assert.equal(ids.size, first.items.length + second.items.length);
  });

  it('rejects duplicate create and stale version updates', async () => {
    const { plans } = createInMemoryExecutionStores();
    const input = buildPlanInput({ executionId: 'exec-dup' });
    await plans.create(input);

    await assert.rejects(
      () => plans.create(input),
      RepositoryAlreadyExistsError,
    );

    await assert.rejects(
      () =>
        plans.update(
          TENANT_A,
          'exec-dup',
          { metadata: { stale: true } },
          { expectedVersion: 99 },
        ),
      RepositoryConflictError,
    );
  });

  it('returns safe not-found across tenants', async () => {
    const { plans } = createInMemoryExecutionStores();
    await plans.create(
      buildPlanInput({ executionId: 'exec-iso', tenantId: TENANT_A }),
    );

    const crossTenant = await plans.getById(TENANT_B, 'exec-iso');
    assert.equal(crossTenant, undefined);

    await assert.rejects(
      () =>
        plans.update(
          TENANT_B,
          'exec-iso',
          { metadata: {} },
          { expectedVersion: 1 },
        ),
      RepositoryNotFoundError,
    );
  });

  it('rejects cross-scope pagination tokens', async () => {
    const { plans } = createInMemoryExecutionStores();
    await plans.create(
      buildPlanInput({ executionId: 'exec-a1', workflowId: 'wf-a' }),
    );
    await plans.create(
      buildPlanInput({ executionId: 'exec-a2', workflowId: 'wf-a' }),
    );
    const workflowPage = await plans.listByWorkflow(TENANT_A, 'wf-a', { limit: 1 });
    assert.ok(workflowPage.nextToken, 'expected paginated workflow list');

    await assert.rejects(
      () =>
        plans.listByStatus(TENANT_A, 'DRAFT', {
          nextToken: workflowPage.nextToken,
        }),
      InvalidPaginationTokenError,
    );
  });

  it('lists by workflow and status within tenant', async () => {
    const { plans } = createInMemoryExecutionStores();
    const created = await plans.create(
      buildPlanInput({
        executionId: 'exec-wf',
        approvalRequired: true,
        approvalStatus: initialApprovalStatus(true),
      }),
    );

    await plans.transitionStatus(
      TENANT_A,
      created.executionId,
      'PENDING_APPROVAL',
      { expectedVersion: created.version },
    );

    const byStatus = await plans.listByStatus(TENANT_A, 'PENDING_APPROVAL');
    assert.equal(byStatus.items.length, 1);
  });
});
