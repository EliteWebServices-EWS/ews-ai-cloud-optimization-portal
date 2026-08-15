import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Ec2DiscoveryRunRepository } from '../../repositories/contracts/ec2-cloud-resource-repository';
import type { Ec2CostAnalysisRunRepository } from '../../repositories/contracts/ec2-cost-repository';
import type { Ec2SecurityAnalysisRunRepository } from '../../repositories/contracts/ec2-security-repository';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import { MockEc2SecurityRepository } from '../../repositories/mock/mock-ec2-security-repository';
import { buildStageExecutionOwnerId } from '../../services/ec2-stage-run-execution-metadata';
import {
  Ec2AsyncJobStageCompletionService,
  stageProofIsComplete,
  stageProofRequiresExecutionClaim,
} from '../../services/ec2-async-job-stage-completion';

const TENANT = 'tenant-stage-proof';
const ACCOUNT = '572262081497';
const NOW_MS = Date.parse('2026-08-15T12:00:00.000Z');

class SpyDiscoveryRunRepository
  extends MockEc2CloudResourceRepository
  implements Ec2DiscoveryRunRepository
{
  lastGetRunOptions?: { consistentRead?: boolean };

  override async getRun(
    tenantId: string,
    accountId: string,
    runId: string,
    options?: { consistentRead?: boolean },
  ) {
    this.lastGetRunOptions = options;
    return super.getRun(tenantId, accountId, runId, options);
  }
}

class SpyCostRunRepository extends MockEc2CostRepository implements Ec2CostAnalysisRunRepository {
  lastGetRunOptions?: { consistentRead?: boolean };

  override async getRun(
    tenantId: string,
    accountId: string,
    runId: string,
    options?: { consistentRead?: boolean },
  ) {
    this.lastGetRunOptions = options;
    return super.getRun(tenantId, accountId, runId, options);
  }
}

class SpySecurityRunRepository
  extends MockEc2SecurityRepository
  implements Ec2SecurityAnalysisRunRepository
{
  lastGetRunOptions?: { consistentRead?: boolean };

  override async getRun(
    tenantId: string,
    accountId: string,
    runId: string,
    options?: { consistentRead?: boolean },
  ) {
    this.lastGetRunOptions = options;
    return super.getRun(tenantId, accountId, runId, options);
  }
}

describe('Ec2AsyncJobStageCompletionService', () => {
  it('discoveryRunProof requests strongly consistent getRun', async () => {
    const discoveryRuns = new SpyDiscoveryRunRepository();
    const service = new Ec2AsyncJobStageCompletionService(
      discoveryRuns,
      new MockEc2CostRepository(),
      new MockEc2SecurityRepository(),
      () => NOW_MS,
    );

    await service.discoveryRunProof(TENANT, ACCOUNT, 'missing-run');

    assert.deepEqual(discoveryRuns.lastGetRunOptions, { consistentRead: true });
  });

  it('costRunProof requests strongly consistent getRun', async () => {
    const costRuns = new SpyCostRunRepository();
    const service = new Ec2AsyncJobStageCompletionService(
      new MockEc2CloudResourceRepository(),
      costRuns,
      new MockEc2SecurityRepository(),
      () => NOW_MS,
    );

    await service.costRunProof(TENANT, ACCOUNT, 'missing-run');

    assert.deepEqual(costRuns.lastGetRunOptions, { consistentRead: true });
  });

  it('securityRunProof requests strongly consistent getRun', async () => {
    const securityRuns = new SpySecurityRunRepository();
    const service = new Ec2AsyncJobStageCompletionService(
      new MockEc2CloudResourceRepository(),
      new MockEc2CostRepository(),
      securityRuns,
      () => NOW_MS,
    );

    await service.securityRunProof(TENANT, ACCOUNT, 'missing-run');

    assert.deepEqual(securityRuns.lastGetRunOptions, { consistentRead: true });
  });

  it('does not treat active RUNNING lease as complete', async () => {
    const discoveryRuns = new MockEc2CloudResourceRepository();
    const runId = 'job-active#discovery';
    await discoveryRuns.claimExecution({
      runId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      requestedRegions: ['us-east-1'],
      startedAt: new Date(NOW_MS).toISOString(),
      nowMs: NOW_MS,
      executionOwnerIdForAttempt: (attempt) =>
        buildStageExecutionOwnerId('job-active', 'discovery', attempt),
    });

    const service = new Ec2AsyncJobStageCompletionService(
      discoveryRuns,
      new MockEc2CostRepository(),
      new MockEc2SecurityRepository(),
      () => NOW_MS,
    );
    const proof = await service.discoveryRunProof(TENANT, ACCOUNT, runId);

    assert.equal(proof.state, 'in_progress_active');
    assert.equal(stageProofIsComplete(proof), false);
    assert.equal(stageProofRequiresExecutionClaim(proof), false);
  });

  it('classifies completed discovery run immediately after completeRun', async () => {
    const discoveryRuns = new SpyDiscoveryRunRepository();
    const runId = 'job-complete#discovery';
    const claimed = await discoveryRuns.claimExecution({
      runId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      requestedRegions: ['us-east-1'],
      startedAt: new Date(NOW_MS).toISOString(),
      nowMs: NOW_MS,
      executionOwnerIdForAttempt: (attempt) =>
        buildStageExecutionOwnerId('job-complete', 'discovery', attempt),
    });
    await discoveryRuns.completeRun({
      tenantId: TENANT,
      accountId: ACCOUNT,
      runId,
      expectedVersion: claimed.version,
      status: 'SUCCEEDED',
      completedAt: '2026-08-15T12:05:00.000Z',
      resourceCounts: { INSTANCE: 1 },
      regionsSucceeded: ['us-east-1'],
      regionsFailed: [],
      warnings: [],
    });

    const service = new Ec2AsyncJobStageCompletionService(
      discoveryRuns,
      new MockEc2CostRepository(),
      new MockEc2SecurityRepository(),
      () => NOW_MS,
    );
    const proof = await service.discoveryRunProof(TENANT, ACCOUNT, runId);

    assert.deepEqual(discoveryRuns.lastGetRunOptions, { consistentRead: true });
    assert.equal(proof.state, 'complete');
    assert.equal(stageProofIsComplete(proof), true);
  });
});
