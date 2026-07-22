import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DynamoDbVerificationRepository } from '../../engines/verification';
import type { VerificationOutput } from '../../engines/verification';
import { createFakePersistenceTable } from './support/fake-persistence-table';

function buildOutput(
  overrides: Partial<VerificationOutput> = {}
): VerificationOutput {
  return {
    tenantId: 'tenant-a',
    workflowId: 'workflow-001',
    executionId: 'execution-001',
    expectation: {
      expectedMonthlySavings: 12,
      expectedInstanceType: 'm5.medium',
      previousInstanceType: 'm5.large',
      currency: 'USD',
    },
    observation: { resourceId: 'i-001' } as VerificationOutput['observation'],
    result: {
      status: 'verified',
      verifiedSavings: 12,
    } as VerificationOutput['result'],
    recordedAt: '2026-07-21T12:00:00.000Z',
    ...overrides,
  };
}

describe('DynamoDbVerificationRepository', () => {
  it('round-trips verification outputs by workflow and execution ID', async () => {
    const repository = new DynamoDbVerificationRepository(
      createFakePersistenceTable()
    );

    await repository.save(buildOutput());

    assert.equal(
      (await repository.findByWorkflowId('tenant-a', 'workflow-001'))?.result
        .verifiedSavings,
      12
    );
    assert.equal(
      (await repository.findByExecutionId('tenant-a', 'execution-001'))
        ?.workflowId,
      'workflow-001'
    );
  });

  it('survives a fresh repository over the same table (restart)', async () => {
    const table = createFakePersistenceTable();
    await new DynamoDbVerificationRepository(table).save(buildOutput());

    // A new adapter instance models a Lambda cold start against durable storage.
    const afterRestart = new DynamoDbVerificationRepository(table);
    assert.equal(
      (await afterRestart.findByWorkflowId('tenant-a', 'workflow-001'))
        ?.executionId,
      'execution-001'
    );
  });

  it('never exposes another tenant\'s outputs', async () => {
    const repository = new DynamoDbVerificationRepository(
      createFakePersistenceTable()
    );
    await repository.save(buildOutput());

    assert.equal(
      await repository.findByWorkflowId('tenant-b', 'workflow-001'),
      undefined
    );
    assert.equal(
      await repository.findByExecutionId('tenant-b', 'execution-001'),
      undefined
    );
    assert.deepEqual(await repository.list('tenant-b'), []);
  });
});
