import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RepositoryConflictError } from '../../database';

import {
  buildPlanInput,
  createInMemoryExecutionStores,
  createTestOrchestrator,
  TENANT_A,
} from '../integration/execution/fixtures';

describe('Execution concurrency protection', () => {
  it('allows only one optimistic plan update to succeed under contention', async () => {
    const { plans } = createInMemoryExecutionStores();
    const created = await plans.create(buildPlanInput({ executionId: 'exec-conc' }));

    const first = plans.update(
      TENANT_A,
      created.executionId,
      { metadata: { worker: 'a' } },
      { expectedVersion: created.version },
    );
    const second = plans.update(
      TENANT_A,
      created.executionId,
      { metadata: { worker: 'b' } },
      { expectedVersion: created.version },
    );

    const results = await Promise.allSettled([first, second]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0]?.reason instanceof RepositoryConflictError);
  });

  it('prevents duplicate execution run ids for the same tenant', async () => {
    const { runs } = createTestOrchestrator();
    const base = {
      tenantId: TENANT_A,
      runId: 'run-dup',
      correlationId: 'c',
      requestId: 'r',
      actorId: 'a',
      mode: 'PRODUCTION' as const,
      service: 'ec2' as const,
      action: 'START_INSTANCE',
      resourceId: 'i',
      region: 'us-east-1',
      status: 'RUNNING' as const,
      rollbackState: { eligible: true },
    };

    await runs.create(base);
    await assert.rejects(() => runs.create(base));
  });
});
