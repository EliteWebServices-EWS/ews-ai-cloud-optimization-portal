import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Ec2AsyncJobRecord } from '../../async-jobs/ec2-async-job-models';
import { EC2_ASYNC_JOB_TYPE } from '../../database/async-jobs';
import { isEc2AsyncJobActive } from '../../services/ec2-async-job-active';
import {
  classifyScopeBlockFromProof,
  ec2AsyncJobStageHasAuthoritativeLeaseProof,
  isEc2AsyncJobBlockingSameScopeStart,
} from '../../services/ec2-async-job-scope-blocker';
import { Ec2AsyncJobStageCompletionService } from '../../services/ec2-async-job-stage-completion';
import { Ec2AsyncJobApiService } from '../../services/ec2-async-job-api-service';
import { MockEc2AsyncJobRepository } from '../../repositories/mock/mock-ec2-async-job-repository';

const TENANT = 'tenant-scope';
const ACCOUNT = '572262081497';
const NOW = Date.parse('2026-08-10T12:00:00.000Z');
const ANCIENT = '2020-01-01T00:00:00.000Z';

function job(overrides: Partial<Ec2AsyncJobRecord> = {}): Ec2AsyncJobRecord {
  return {
    tenantId: TENANT,
    jobId: 'job-stale',
    accountId: ACCOUNT,
    regions: ['us-east-1'],
    jobType: EC2_ASYNC_JOB_TYPE,
    status: 'RUNNING',
    queueStatus: 'ENQUEUED',
    stage: 'DISCOVERY',
    correlationId: 'c1',
    idempotencyKey: 'idem-1',
    requestFingerprint: 'fp-1',
    retryCount: 3,
    version: 4,
    createdAt: '2026-08-09T16:04:09.000Z',
    startedAt: '2026-08-09T17:04:11.000Z',
    updatedAt: '2026-08-09T17:05:00.000Z',
    ...overrides,
  };
}

function mockStageCompletion(proofs: {
  discovery?: Awaited<ReturnType<Ec2AsyncJobStageCompletionService['discoveryRunProof']>>;
  cost?: Awaited<ReturnType<Ec2AsyncJobStageCompletionService['costRunProof']>>;
  security?: Awaited<ReturnType<Ec2AsyncJobStageCompletionService['securityRunProof']>>;
  onCall?: () => void;
}) {
  return {
    discoveryRunProof: async () => {
      proofs.onCall?.();
      return proofs.discovery ?? { state: 'missing' as const };
    },
    costRunProof: async () => {
      proofs.onCall?.();
      return proofs.cost ?? { state: 'missing' as const };
    },
    securityRunProof: async () => {
      proofs.onCall?.();
      return proofs.security ?? { state: 'missing' as const };
    },
  } as unknown as Ec2AsyncJobStageCompletionService;
}

describe('ec2-async-job-scope-blocker', () => {
  it('QUEUED jobs block same-scope start', () => {
    assert.equal(isEc2AsyncJobActive(job({ status: 'QUEUED', stage: 'ENQUEUE' })), true);
  });

  it('SUCCEEDED and FAILED do not block', () => {
    assert.equal(isEc2AsyncJobActive(job({ status: 'SUCCEEDED', stage: 'COMPLETE' })), false);
    assert.equal(isEc2AsyncJobActive(job({ status: 'FAILED', stage: 'DISCOVERY' })), false);
  });

  it('ENQUEUE_FAILED does not block', () => {
    assert.equal(
      isEc2AsyncJobActive(job({ status: 'QUEUED', queueStatus: 'ENQUEUE_FAILED' })),
      false,
    );
  });

  it('PARTIAL with COMPLETE stage is terminal for active guard', () => {
    assert.equal(isEc2AsyncJobActive(job({ status: 'PARTIAL', stage: 'COMPLETE' })), false);
  });

  it('healthy DISCOVERY lease blocks', () => {
    assert.equal(
      classifyScopeBlockFromProof(job(), { state: 'in_progress_active' }, NOW),
      true,
    );
  });

  it('expired DISCOVERY lease does not block', () => {
    assert.equal(
      classifyScopeBlockFromProof(job(), { state: 'in_progress_stale' }, NOW),
      false,
    );
  });

  it('healthy COST lease blocks', () => {
    assert.equal(
      classifyScopeBlockFromProof(
        job({ stage: 'COST_ANALYSIS' }),
        { state: 'in_progress_active' },
        NOW,
      ),
      true,
    );
  });

  it('expired COST lease does not block', () => {
    assert.equal(
      classifyScopeBlockFromProof(
        job({ stage: 'COST_ANALYSIS' }),
        { state: 'in_progress_stale' },
        NOW,
      ),
      false,
    );
  });

  it('healthy SECURITY lease blocks', () => {
    assert.equal(
      classifyScopeBlockFromProof(
        job({ stage: 'SECURITY_ANALYSIS' }),
        { state: 'in_progress_active' },
        NOW,
      ),
      true,
    );
  });

  it('expired SECURITY lease does not block', () => {
    assert.equal(
      classifyScopeBlockFromProof(
        job({ stage: 'SECURITY_ANALYSIS' }),
        { state: 'in_progress_stale' },
        NOW,
      ),
      false,
    );
  });

  it('GOVERNANCE_ANALYSIS keeps blocking without lease proof even when metadata is old', () => {
    assert.equal(ec2AsyncJobStageHasAuthoritativeLeaseProof('GOVERNANCE_ANALYSIS'), false);
    assert.equal(
      classifyScopeBlockFromProof(
        job({ status: 'RUNNING', stage: 'GOVERNANCE_ANALYSIS', updatedAt: ANCIENT }),
        { state: 'ambiguous' },
        NOW,
      ),
      true,
    );
  });

  it('FINALIZING keeps blocking without lease proof even when metadata is old', () => {
    assert.equal(
      classifyScopeBlockFromProof(
        job({ status: 'RUNNING', stage: 'FINALIZING', updatedAt: ANCIENT }),
        { state: 'ambiguous' },
        NOW,
      ),
      true,
    );
  });

  it('COMPLETE stage terminal job does not block', async () => {
    let calls = 0;
    const stageCompletion = mockStageCompletion({
      onCall: () => {
        calls += 1;
      },
    });
    const blocks = await isEc2AsyncJobBlockingSameScopeStart(
      job({ status: 'SUCCEEDED', stage: 'COMPLETE' }),
      stageCompletion,
      NOW,
    );
    assert.equal(blocks, false);
    assert.equal(calls, 0);
  });

  it('PARTIAL non-complete with active lease blocks', async () => {
    const stageCompletion = mockStageCompletion({
      discovery: { state: 'in_progress_active' },
    });
    const blocks = await isEc2AsyncJobBlockingSameScopeStart(
      job({ status: 'PARTIAL', stage: 'DISCOVERY' }),
      stageCompletion,
      NOW,
    );
    assert.equal(blocks, true);
  });

  it('RUNNING with stale discovery proof does not block', async () => {
    const stageCompletion = mockStageCompletion({
      discovery: { state: 'in_progress_stale' },
    });
    const blocks = await isEc2AsyncJobBlockingSameScopeStart(job(), stageCompletion, NOW);
    assert.equal(blocks, false);
  });

  it('terminal jobs skip stage-proof reads in presentJobForApi', async () => {
    let proofCalls = 0;
    const stageCompletion = mockStageCompletion({
      onCall: () => {
        proofCalls += 1;
      },
    });
    const api = new Ec2AsyncJobApiService(new MockEc2AsyncJobRepository(), stageCompletion);
    const presented = await api.presentJobForApi(
      job({ status: 'FAILED', stage: 'DISCOVERY', completedAt: '2026-08-10T00:00:00.000Z' }),
    );
    assert.equal(presented.isScopeBlocking, false);
    assert.equal(proofCalls, 0);
  });

  it('list presentation skips proof reads for terminal rows only', async () => {
    let proofCalls = 0;
    const stageCompletion = mockStageCompletion({
      discovery: { state: 'in_progress_stale' },
      onCall: () => {
        proofCalls += 1;
      },
    });
    const api = new Ec2AsyncJobApiService(new MockEc2AsyncJobRepository(), stageCompletion);
    const rows = [
      job({ status: 'SUCCEEDED', stage: 'COMPLETE', jobId: 'j1' }),
      job({ status: 'FAILED', stage: 'DISCOVERY', jobId: 'j2' }),
      job({ status: 'RUNNING', stage: 'DISCOVERY', jobId: 'j3' }),
    ];
    await Promise.all(rows.map((row) => api.presentJobForApi(row)));
    assert.equal(proofCalls, 1);
  });
});
