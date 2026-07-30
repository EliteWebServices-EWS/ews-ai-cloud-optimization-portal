import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPlanInput,
  createInMemoryExecutionStores,
  createTestOrchestrator,
  TENANT_A,
  TENANT_B,
} from '../integration/execution/fixtures';

describe('Execution tenant isolation security', () => {
  it('isolates execution plans by tenant partition', async () => {
    const { plans } = createInMemoryExecutionStores();
    await plans.create(buildPlanInput({ executionId: 'exec-iso-plan', tenantId: TENANT_A }));

    assert.equal(await plans.getById(TENANT_B, 'exec-iso-plan'), undefined);

    const tenantBList = await plans.listByTenant(TENANT_B);
    assert.equal(tenantBList.items.length, 0);
  });

  it('isolates execution runs by tenant', async () => {
    const { runs } = createTestOrchestrator();
    await runs.create({
      tenantId: TENANT_A,
      runId: 'run-iso',
      correlationId: 'c',
      requestId: 'r',
      actorId: 'a',
      mode: 'PRODUCTION',
      service: 'ec2',
      action: 'START_INSTANCE',
      resourceId: 'i',
      region: 'us-east-1',
      status: 'SUCCEEDED',
      rollbackState: { eligible: true },
    });

    assert.equal(await runs.getById(TENANT_B, 'run-iso'), undefined);
  });

  it('isolates execution history by tenant', async () => {
    const { history } = createInMemoryExecutionStores();
    await history.append({
      tenantId: TENANT_A,
      historyId: 'hist-1',
      executionId: 'exec-h',
      workflowId: 'wf',
      eventType: 'PLAN_CREATED',
      actorId: 'a',
      createdAt: new Date().toISOString(),
    });

    const page = await history.listByExecution(TENANT_B, 'exec-h');
    assert.equal(page.items.length, 0);
  });
});
