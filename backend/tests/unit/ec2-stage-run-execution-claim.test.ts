import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  Ec2StageRunActiveLeaseError,
  Ec2StageRunPermanentFailureError,
  planStageRunExecutionClaim,
} from '../../repositories/ec2-stage-run-execution-claim';
import {
  computeLeaseExpiresAtIso,
  EC2_STAGE_EXECUTION_LEASE_SECONDS,
} from '../../services/ec2-stage-run-execution-metadata';

describe('planStageRunExecutionClaim', () => {
  const owner = (attempt: number) => `async:job-1:discovery:attempt:${attempt}`;
  const baseNow = Date.parse('2026-06-01T12:00:00.000Z');

  it('plans create when run is missing', () => {
    const plan = planStageRunExecutionClaim(null, baseNow, owner);
    assert.equal(plan.kind, 'create');
    assert.equal(plan.attemptCount, 1);
  });

  it('rejects active RUNNING lease', () => {
    assert.throws(
      () =>
        planStageRunExecutionClaim(
          {
            status: 'RUNNING',
            version: 1,
            leaseExpiresAt: computeLeaseExpiresAtIso(baseNow),
            attemptCount: 1,
          },
          baseNow,
          owner,
        ),
      Ec2StageRunActiveLeaseError,
    );
  });

  it('plans reclaim when RUNNING lease expired', () => {
    const plan = planStageRunExecutionClaim(
      {
        status: 'RUNNING',
        version: 2,
        leaseExpiresAt: new Date(baseNow - 60_000).toISOString(),
        attemptCount: 1,
      },
      baseNow,
      owner,
    );
    assert.equal(plan.kind, 'reclaim');
    if (plan.kind === 'reclaim') {
      assert.equal(plan.expectedVersion, 2);
      assert.equal(plan.attemptCount, 2);
    }
  });

  it('plans reclaim for retryable FAILED runs', () => {
    const plan = planStageRunExecutionClaim(
      {
        status: 'FAILED',
        completedAt: new Date(baseNow).toISOString(),
        version: 3,
        attemptCount: 2,
        failureRetryable: true,
      },
      baseNow,
      owner,
    );
    assert.equal(plan.kind, 'reclaim');
    if (plan.kind === 'reclaim') {
      assert.equal(plan.attemptCount, 3);
    }
  });

  it('rejects permanent FAILED runs', () => {
    assert.throws(
      () =>
        planStageRunExecutionClaim(
          {
            status: 'FAILED',
            completedAt: new Date(baseNow).toISOString(),
            version: 1,
            failureRetryable: false,
          },
          baseNow,
          owner,
        ),
      Ec2StageRunPermanentFailureError,
    );
  });

  it('uses lease duration safely above zero', () => {
    assert.ok(EC2_STAGE_EXECUTION_LEASE_SECONDS > 300);
  });
});
