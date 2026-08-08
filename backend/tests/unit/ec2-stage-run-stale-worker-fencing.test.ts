import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RepositoryConflictError } from '../../database';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import {
  buildStageExecutionOwnerId,
  EC2_STAGE_EXECUTION_LEASE_SECONDS,
} from '../../services/ec2-stage-run-execution-metadata';

const TENANT = 'tenant-stale-fence';
const ACCOUNT = '111122223333';
const JOB_ID = 'job-stale-fence';
const RUN_ID = `${JOB_ID}#discovery`;

async function reclaimScenario() {
  const repo = new MockEc2CloudResourceRepository();
  const workerAClaimTimeMs = Date.parse('2026-06-01T12:00:00.000Z');
  const ownerForAttempt = (attemptCount: number) =>
    buildStageExecutionOwnerId(JOB_ID, 'discovery', attemptCount);
  const startedAt = new Date(workerAClaimTimeMs).toISOString();

  const workerARun = await repo.claimExecution({
    runId: RUN_ID,
    tenantId: TENANT,
    accountId: ACCOUNT,
    requestedRegions: ['us-east-1'],
    startedAt,
    nowMs: workerAClaimTimeMs,
    executionOwnerIdForAttempt: ownerForAttempt,
  });

  const versionN = workerARun.version;
  const ownerA = workerARun.executionOwnerId;

  const workerBClaimTimeMs =
    workerAClaimTimeMs + EC2_STAGE_EXECUTION_LEASE_SECONDS * 1000 + 1;
  const workerBRun = await repo.claimExecution({
    runId: RUN_ID,
    tenantId: TENANT,
    accountId: ACCOUNT,
    requestedRegions: ['us-east-1'],
    startedAt,
    nowMs: workerBClaimTimeMs,
    executionOwnerIdForAttempt: ownerForAttempt,
  });

  return { repo, versionN, ownerA, workerBRun };
}

function terminalCompleteInput(
  status: 'SUCCEEDED' | 'FAILED',
  expectedVersion: number,
  completedAt: string,
) {
  return {
    tenantId: TENANT,
    accountId: ACCOUNT,
    runId: RUN_ID,
    expectedVersion,
    status,
    completedAt,
    resourceCounts: {} as Record<string, number>,
    regionsSucceeded: ['us-east-1'] as string[],
    regionsFailed: [] as string[],
    warnings: [] as string[],
    ...(status === 'FAILED' ? { failureRetryable: true } : {}),
  };
}

describe('stale worker execution fencing (discovery stage run repository)', () => {
  it('reclaims with a newer version and Worker B ownership after lease expiry', async () => {
    const { repo, versionN, ownerA, workerBRun } = await reclaimScenario();

    assert.ok(workerBRun.version > versionN);
    assert.equal(workerBRun.status, 'RUNNING');
    assert.notEqual(workerBRun.executionOwnerId, ownerA);
    assert.equal(
      workerBRun.executionOwnerId,
      buildStageExecutionOwnerId(JOB_ID, 'discovery', workerBRun.attemptCount ?? 2),
    );
    assert.ok(workerBRun.leaseExpiresAt);

    const reloaded = await repo.getRun(TENANT, ACCOUNT, RUN_ID);
    assert.equal(reloaded?.version, workerBRun.version);
    assert.equal(reloaded?.executionOwnerId, workerBRun.executionOwnerId);
  });

  for (const status of ['SUCCEEDED', 'FAILED'] as const) {
    it(`rejects stale Worker A completeRun (${status}) after Worker B reclaim`, async () => {
      const { repo, versionN, workerBRun } = await reclaimScenario();
      const completedAt = new Date(Date.parse('2026-06-01T14:00:00.000Z')).toISOString();

      await assert.rejects(
        () => repo.completeRun(terminalCompleteInput(status, versionN, completedAt)),
        RepositoryConflictError,
      );

      const after = await repo.getRun(TENANT, ACCOUNT, RUN_ID);
      assert.equal(after?.version, workerBRun.version);
      assert.equal(after?.status, 'RUNNING');
      assert.equal(after?.executionOwnerId, workerBRun.executionOwnerId);
      assert.equal(after?.completedAt, undefined);
    });
  }
});
