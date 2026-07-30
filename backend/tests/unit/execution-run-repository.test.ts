import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RepositoryConflictError } from '../../database';
import { MockExecutionRunRepository } from '../../repositories/mock/mock-execution-run-repository';

test('execution run repository retains tenant context and handles version conflicts', async () => {
  const repository = new MockExecutionRunRepository();
  const created = await repository.create({
    tenantId: 'tenant-z',
    runId: 'run-1',
    correlationId: 'corr',
    requestId: 'req',
    actorId: 'actor',
    mode: 'PRODUCTION',
    service: 'ec2',
    action: 'START_INSTANCE',
    resourceId: 'i-1',
    region: 'us-east-1',
    status: 'RUNNING',
    rollbackState: { eligible: true },
  });

  assert.equal(created.tenantId, 'tenant-z');

  await assert.rejects(
    () =>
      repository.update(
        'tenant-z',
        'run-1',
        { status: 'FAILED' },
        { expectedVersion: created.version + 99 },
      ),
    RepositoryConflictError,
  );
});
