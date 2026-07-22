import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockVerificationRepository } from '../../engines/verification';
import type { VerificationOutput } from '../../engines/verification';

function buildOutput(overrides: Partial<VerificationOutput> = {}): VerificationOutput {
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
    result: { status: 'verified', verifiedSavings: 12 } as VerificationOutput['result'],
    recordedAt: '2026-07-21T12:00:00.000Z',
    ...overrides,
  };
}

describe('MockVerificationRepository', () => {
  it('persists verification outputs by workflow and execution ID', async () => {
    const repository = new MockVerificationRepository();
    const output = buildOutput();
    await repository.save(output);
    output.result.verifiedSavings = 0;

    assert.equal(
      (await repository.findByWorkflowId('tenant-a', 'workflow-001'))?.result.verifiedSavings,
      12
    );
    assert.equal(
      (await repository.findByExecutionId('tenant-a', 'execution-001'))?.workflowId,
      'workflow-001'
    );
  });

  it('does not expose verification outputs across tenants', async () => {
    const repository = new MockVerificationRepository();
    await repository.save(buildOutput());

    assert.equal(await repository.findByWorkflowId('tenant-b', 'workflow-001'), undefined);
    assert.equal(await repository.findByExecutionId('tenant-b', 'execution-001'), undefined);
    assert.deepEqual(await repository.list('tenant-b'), []);
  });
});
