import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toVerificationRecordFromOutput } from '../../post-action-verification/repository-convergence';
import type { VerificationOutput } from '../../engines/verification/verification.repository';
import { VERIFICATION_STATUS } from '../../shared/constants';

describe('Verification repository convergence adapter', () => {
  it('maps engine VerificationOutput to generic VerificationRecord without a third repository', () => {
    const output: VerificationOutput = {
      tenantId: 'tenant-a',
      accountId: '111122223333',
      workflowId: 'wf-1',
      executionId: 'exec-1',
      expectation: {
        expectedMonthlySavings: 15,
        expectedInstanceType: 't3.small',
        previousInstanceType: 't3.medium',
        currency: 'USD',
      },
      observation: null,
      result: {
        status: VERIFICATION_STATUS.PENDING,
        expectedSavings: 15,
        actualSavings: 0,
        verifiedSavings: 0,
        variance: -15,
        variancePercentage: -100,
        stateMatched: false,
        confidenceScore: 0,
        message: 'pending',
      },
      recordedAt: '2026-08-20T12:00:00.000Z',
    };

    const record = toVerificationRecordFromOutput(output);
    assert.equal(record.tenantId, 'tenant-a');
    assert.equal(record.workflowId, 'wf-1');
    assert.equal(record.outcome, VERIFICATION_STATUS.PENDING);
    assert.equal(record.payload?.executionId, 'exec-1');
    assert.equal(record.payload?.accountId, '111122223333');
  });
});
