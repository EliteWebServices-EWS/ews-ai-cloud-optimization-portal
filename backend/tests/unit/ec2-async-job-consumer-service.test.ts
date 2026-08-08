import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { buildEc2IntelligenceQueueMessage } from '../../async-jobs/ec2-intelligence-queue-message';
import { buildEc2AsyncJobRequestFingerprint } from '../../database/async-jobs';
import { RepositoryConflictError } from '../../database';
import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';
import { MockEc2AsyncJobRepository } from '../../repositories/mock/mock-ec2-async-job-repository';
import {
  EC2_ASYNC_JOB_EVENT,
  Ec2AsyncJobConsumerService,
} from '../../services/ec2-async-job-consumer-service';
import { Ec2AsyncJobConsumerRetryableError } from '../../services/ec2-async-job-consumer-errors';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import { MockEc2SecurityRepository } from '../../repositories/mock/mock-ec2-security-repository';
import { Ec2AsyncJobStageCompletionService } from '../../services/ec2-async-job-stage-completion';
import { Ec2AsyncJobStageExecutionService } from '../../services/ec2-async-job-stage-execution';
import { computeLeaseExpiresAtIso } from '../../services/ec2-stage-run-execution-metadata';
import {
  ec2AsyncJobCostRunId,
  ec2AsyncJobDiscoveryRunId,
  ec2AsyncJobSecurityRunId,
  EC2_ANALYSIS_CONSUMER_LAMBDA_TIMEOUT_SECONDS,
  EC2_INTELLIGENCE_QUEUE_VISIBILITY_TIMEOUT_SECONDS,
} from '../../services/ec2-async-job-stage-runs';
import { seedVerifiedAccount } from '../integration/ec2-discovery-http.helpers';

const TENANT = 'tenant-consumer-a';
const ACCOUNT = '111122223333';

function messageForJob(jobId: string, correlationId = 'corr-1') {
  return buildEc2IntelligenceQueueMessage({
    jobId,
    tenantId: TENANT,
    accountId: ACCOUNT,
    regions: ['us-east-1'],
    correlationId,
  });
}

async function seedQueuedJob(
  jobs: MockEc2AsyncJobRepository,
  jobId: string,
  idempotencyKey: string,
) {
  return jobs.createIdempotentJob({
    tenantId: TENANT,
    jobId,
    accountId: ACCOUNT,
    regions: ['us-east-1'],
    jobType: 'EC2_INTELLIGENCE',
    correlationId: 'corr-seed',
    idempotencyKey,
    requestFingerprint: buildEc2AsyncJobRequestFingerprint({
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      jobType: 'EC2_INTELLIGENCE',
    }),
  });
}

function createConsumer(deps: {
  jobs: MockEc2AsyncJobRepository;
  awsAccounts: MockAwsAccountRepository;
  cloudRepo?: MockEc2CloudResourceRepository;
  costRepo?: MockEc2CostRepository;
  securityRepo?: MockEc2SecurityRepository;
  discoveryCalls?: { count: number };
  costCalls?: { count: number };
  securityCalls?: { count: number };
  discoveryError?: Error;
  nowMs?: () => number;
}) {
  const discoveryCalls = deps.discoveryCalls ?? { count: 0 };
  const costCalls = deps.costCalls ?? { count: 0 };
  const securityCalls = deps.securityCalls ?? { count: 0 };
  const cloudRepo = deps.cloudRepo ?? new MockEc2CloudResourceRepository();
  const costRepo = deps.costRepo ?? new MockEc2CostRepository();
  const securityRepo = deps.securityRepo ?? new MockEc2SecurityRepository();
  const nowMs = deps.nowMs ?? (() => Date.now());

  return new Ec2AsyncJobConsumerService({
    jobs: deps.jobs,
    awsAccounts: deps.awsAccounts,
    stageCompletion: new Ec2AsyncJobStageCompletionService(
      cloudRepo,
      costRepo,
      securityRepo,
      nowMs,
    ),
    stageExecution: new Ec2AsyncJobStageExecutionService(
      cloudRepo,
      costRepo,
      securityRepo,
      nowMs,
    ),
    discovery: {
      startDiscovery: async (
        _tenantId: string,
        accountId: string,
        input?: { regions?: string[]; runId?: string; resumeRunExpectedVersion?: number },
      ) => {
        discoveryCalls.count += 1;
        if (deps.discoveryError) {
          throw deps.discoveryError;
        }
        const runId = input?.runId ?? ec2AsyncJobDiscoveryRunId('unknown');
        const startedAt = new Date().toISOString();
        let run = await cloudRepo.getRun(TENANT, accountId, runId);
        if (!run || input?.resumeRunExpectedVersion == null) {
          run = await cloudRepo.createRun({
            runId,
            tenantId: TENANT,
            accountId,
            requestedRegions: input?.regions ?? ['us-east-1'],
            startedAt,
          });
        }
        await cloudRepo.completeRun({
          tenantId: TENANT,
          accountId,
          runId,
          expectedVersion: run.version,
          status: 'SUCCEEDED',
          completedAt: startedAt,
          resourceCounts: { INSTANCE: 1 },
          regionsSucceeded: input?.regions ?? ['us-east-1'],
          regionsFailed: [],
          warnings: [],
        });
        return { runId, status: 'SUCCEEDED' };
      },
    } as never,
    cost: {
      startCostAnalysis: async (
        _tenantId: string,
        input: {
          accountId: string;
          regions?: string[];
          runId?: string;
          resumeRunExpectedVersion?: number;
        },
      ) => {
        costCalls.count += 1;
        const runId = input.runId ?? ec2AsyncJobCostRunId('unknown');
        const startedAt = new Date().toISOString();
        let run = await costRepo.getRun(TENANT, input.accountId, runId);
        if (!run || input.resumeRunExpectedVersion == null) {
          run = await costRepo.createRun({
            runId,
            tenantId: TENANT,
            accountId: input.accountId,
            regions: input.regions ?? ['us-east-1'],
            observationDays: 14,
            periodSeconds: 3600,
            requestedAt: startedAt,
            startedAt,
          });
        }
        await costRepo.completeRun({
          tenantId: TENANT,
          accountId: input.accountId,
          runId,
          expectedVersion: run.version,
          status: 'SUCCEEDED',
          completedAt: startedAt,
          instancesFound: 0,
          instancesEvaluated: 0,
          recommendationsCreated: 0,
          recommendationsUpdated: 0,
          recommendationsResolved: 0,
          insufficientDataCount: 0,
          regionsSucceeded: input.regions ?? ['us-east-1'],
          regionsFailed: [],
          warnings: [],
        });
        return { runId, status: 'SUCCEEDED' };
      },
    } as never,
    security: {
      startSecurityAnalysis: async (
        tenantId: string,
        input: {
          accountId: string;
          regions?: string[];
          runId?: string;
          resumeRunExpectedVersion?: number;
        },
      ) => {
        securityCalls.count += 1;
        const runId = input.runId ?? ec2AsyncJobSecurityRunId('unknown');
        const startedAt = new Date().toISOString();
        let run = await securityRepo.getRun(tenantId, input.accountId, runId);
        if (!run || input.resumeRunExpectedVersion == null) {
          run = await securityRepo.createRun({
            runId,
            tenantId,
            accountId: input.accountId,
            regions: input.regions ?? ['us-east-1'],
            startedAt,
          });
        }
        await securityRepo.completeRun({
          tenantId,
          accountId: input.accountId,
          runId,
          expectedVersion: run.version,
          status: 'SUCCEEDED',
          completedAt: startedAt,
          instancesFound: 0,
          instancesAnalyzed: 0,
          findingsCreated: 0,
          findingsUpdated: 0,
          findingsResolved: 0,
        });
        return { runId, status: 'SUCCEEDED' };
      },
    } as never,
  });
}

describe('Ec2AsyncJobConsumerService', () => {
  it('rejects scope mismatch without invoking discovery', async () => {
    const jobs = new MockEc2AsyncJobRepository();
    const awsAccounts = new MockAwsAccountRepository();
    await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');
    const job = await seedQueuedJob(jobs, 'job-scope', 'idem-scope');
    const discoveryCalls = { count: 0 };
    const consumer = createConsumer({ jobs, awsAccounts, discoveryCalls });

    const message = messageForJob(job.jobId);
    message.accountId = '999999999999';

    const outcome = await consumer.processValidatedMessage(message, 'req-1');
    assert.equal(outcome, 'ack');
    assert.equal(discoveryCalls.count, 0);
    const updated = await jobs.getJob(TENANT, job.jobId);
    assert.equal(updated?.status, 'FAILED');
  });

  it('claims a QUEUED job with optimistic locking and runs the pipeline', async () => {
    const jobs = new MockEc2AsyncJobRepository();
    const awsAccounts = new MockAwsAccountRepository();
    await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');
    const job = await seedQueuedJob(jobs, 'job-run', 'idem-run');
    const discoveryCalls = { count: 0 };
    const costCalls = { count: 0 };
    const securityCalls = { count: 0 };
    const consumer = createConsumer({
      jobs,
      awsAccounts,
      discoveryCalls,
      costCalls,
      securityCalls,
    });

    const outcome = await consumer.processValidatedMessage(
      messageForJob(job.jobId),
      'req-run',
    );
    assert.equal(outcome, 'ack');
    assert.equal(discoveryCalls.count, 1);
    assert.equal(costCalls.count, 1);
    assert.equal(securityCalls.count, 1);

    const finished = await jobs.getJob(TENANT, job.jobId);
    assert.equal(finished?.status, 'SUCCEEDED');
    assert.equal(finished?.stage, 'COMPLETE');
    assert.ok(finished?.startedAt);
    assert.ok(finished?.completedAt);
  });

  it('acknowledges completed duplicates without re-running engines', async () => {
    const jobs = new MockEc2AsyncJobRepository();
    const awsAccounts = new MockAwsAccountRepository();
    await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');
    const job = await seedQueuedJob(jobs, 'job-dup', 'idem-dup');
    const discoveryCalls = { count: 0 };
    const consumer = createConsumer({ jobs, awsAccounts, discoveryCalls });

    await consumer.processValidatedMessage(messageForJob(job.jobId), 'req-first');
    const before = discoveryCalls.count;
    const outcome = await consumer.processValidatedMessage(messageForJob(job.jobId), 'req-second');
    assert.equal(outcome, 'ack');
    assert.equal(discoveryCalls.count, before);
  });

  it('returns retry for retryable failures and increments retryCount', async () => {
    const jobs = new MockEc2AsyncJobRepository();
    const awsAccounts = new MockAwsAccountRepository();
    await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');
    const job = await seedQueuedJob(jobs, 'job-retry', 'idem-retry');
    const consumer = createConsumer({
      jobs,
      awsAccounts,
      discoveryError: new Ec2AsyncJobConsumerRetryableError('throttled'),
    });

    const outcome = await consumer.processValidatedMessage(messageForJob(job.jobId), 'req-retry');
    assert.equal(outcome, 'retry');
    const updated = await jobs.getJob(TENANT, job.jobId);
    assert.equal(updated?.retryCount, 1);
    assert.ok(updated?.completedAt === undefined);
    const events = await jobs.listEvents(TENANT, job.jobId);
    assert.ok(events.items.some((event) => event.eventType === EC2_ASYNC_JOB_EVENT.RETRYING));
  });

  it('resumes a RUNNING job from the current durable stage', async () => {
    const jobs = new MockEc2AsyncJobRepository();
    const awsAccounts = new MockAwsAccountRepository();
    const cloudRepo = new MockEc2CloudResourceRepository();
    await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');
    const job = await seedQueuedJob(jobs, 'job-resume', 'idem-resume');
    const discoveryRunId = ec2AsyncJobDiscoveryRunId(job.jobId);
    const startedAt = new Date().toISOString();
    const discoveryRun = await cloudRepo.createRun({
      runId: discoveryRunId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      requestedRegions: ['us-east-1'],
      startedAt,
    });
    await cloudRepo.completeRun({
      tenantId: TENANT,
      accountId: ACCOUNT,
      runId: discoveryRunId,
      expectedVersion: discoveryRun.version,
      status: 'SUCCEEDED',
      completedAt: startedAt,
      resourceCounts: {},
      regionsSucceeded: ['us-east-1'],
      regionsFailed: [],
      warnings: [],
    });
    const current = await jobs.updateJob(
      TENANT,
      job.jobId,
      { status: 'RUNNING', stage: 'COST_ANALYSIS', startedAt },
      { expectedVersion: job.version },
    );
    const discoveryCalls = { count: 0 };
    const costCalls = { count: 0 };
    const consumer = createConsumer({ jobs, awsAccounts, cloudRepo, discoveryCalls, costCalls });

    await consumer.processValidatedMessage(messageForJob(current.jobId), 'req-resume');
    assert.equal(discoveryCalls.count, 0);
    assert.equal(costCalls.count, 1);
  });

  it('allows only one concurrent QUEUED claim to append a started event', async () => {
    const jobs = new MockEc2AsyncJobRepository();
    const awsAccounts = new MockAwsAccountRepository();
    await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');
    const job = await seedQueuedJob(jobs, 'job-concurrent', 'idem-concurrent');
    const consumer = createConsumer({ jobs, awsAccounts });

    const context = {
      actor: { authenticated: true, userId: 'system:ec2-async-worker', email: null, roles: [] },
      requestId: 'req-concurrent',
      correlationId: 'corr-concurrent',
    };

    await Promise.all([
      consumer.claimOrReconcileJob(job, context),
      consumer.claimOrReconcileJob(job, context),
    ]);

    const events = await jobs.listEvents(TENANT, job.jobId);
    const started = events.items.filter(
      (event) => event.eventType === EC2_ASYNC_JOB_EVENT.STARTED,
    );
    assert.equal(started.length, 1);
  });

  it('reloads after optimistic conflict during claim', async () => {
    const jobs = new MockEc2AsyncJobRepository();
    const awsAccounts = new MockAwsAccountRepository();
    await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');
    const job = await seedQueuedJob(jobs, 'job-conflict', 'idem-conflict');
    const originalUpdate = jobs.updateJob.bind(jobs);
    let intercepted = false;
    jobs.updateJob = async (tenantId, jobId, changes, options) => {
      if (!intercepted && changes.status === 'RUNNING') {
        intercepted = true;
        await originalUpdate(
          tenantId,
          jobId,
          { status: 'RUNNING', stage: 'DISCOVERY', startedAt: new Date().toISOString() },
          options,
        );
        throw new RepositoryConflictError();
      }
      return originalUpdate(tenantId, jobId, changes, options);
    };

    const discoveryCalls = { count: 0 };
    const consumer = createConsumer({ jobs, awsAccounts, discoveryCalls });
    const outcome = await consumer.processValidatedMessage(messageForJob(job.jobId), 'req-conf');
    assert.equal(outcome, 'ack');
    assert.equal(discoveryCalls.count, 1);
  });

  it('recovers discovery from persisted run without re-executing discovery', async () => {
    const jobs = new MockEc2AsyncJobRepository();
    const awsAccounts = new MockAwsAccountRepository();
    const cloudRepo = new MockEc2CloudResourceRepository();
    await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');
    const job = await seedQueuedJob(jobs, 'job-disc-recover', 'idem-disc-recover');
    const runId = ec2AsyncJobDiscoveryRunId(job.jobId);
    const startedAt = new Date().toISOString();
    const run = await cloudRepo.createRun({
      runId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      requestedRegions: ['us-east-1'],
      startedAt,
    });
    await cloudRepo.completeRun({
      tenantId: TENANT,
      accountId: ACCOUNT,
      runId,
      expectedVersion: run.version,
      status: 'SUCCEEDED',
      completedAt: startedAt,
      resourceCounts: { INSTANCE: 2 },
      regionsSucceeded: ['us-east-1'],
      regionsFailed: [],
      warnings: [],
    });
    await jobs.updateJob(
      TENANT,
      job.jobId,
      { status: 'RUNNING', stage: 'DISCOVERY', startedAt },
      { expectedVersion: job.version },
    );
    const discoveryCalls = { count: 0 };
    const consumer = createConsumer({ jobs, awsAccounts, cloudRepo, discoveryCalls });
    await consumer.processValidatedMessage(messageForJob(job.jobId), 'req-disc-recover');
    assert.equal(discoveryCalls.count, 0);
    const updated = await jobs.getJob(TENANT, job.jobId);
    assert.notEqual(updated?.stage, 'DISCOVERY');
  });

  it('recovers cost analysis from persisted run without re-executing cost service', async () => {
    const jobs = new MockEc2AsyncJobRepository();
    const awsAccounts = new MockAwsAccountRepository();
    const cloudRepo = new MockEc2CloudResourceRepository();
    const costRepo = new MockEc2CostRepository();
    await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');
    const job = await seedQueuedJob(jobs, 'job-cost-recover', 'idem-cost-recover');
    const runId = ec2AsyncJobCostRunId(job.jobId);
    const startedAt = new Date().toISOString();
    const run = await costRepo.createRun({
      runId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      observationDays: 14,
      periodSeconds: 3600,
      requestedAt: startedAt,
      startedAt,
    });
    await costRepo.completeRun({
      tenantId: TENANT,
      accountId: ACCOUNT,
      runId,
      expectedVersion: run.version,
      status: 'SUCCEEDED',
      completedAt: startedAt,
      instancesFound: 1,
      instancesEvaluated: 1,
      recommendationsCreated: 1,
      recommendationsUpdated: 0,
      recommendationsResolved: 0,
      insufficientDataCount: 0,
      regionsSucceeded: ['us-east-1'],
      regionsFailed: [],
      warnings: [],
    });
    await jobs.updateJob(
      TENANT,
      job.jobId,
      { status: 'RUNNING', stage: 'COST_ANALYSIS', startedAt },
      { expectedVersion: job.version },
    );
    const costCalls = { count: 0 };
    const consumer = createConsumer({ jobs, awsAccounts, cloudRepo, costRepo, costCalls });
    await consumer.processValidatedMessage(messageForJob(job.jobId), 'req-cost-recover');
    assert.equal(costCalls.count, 0);
  });

  it('returns retry when stage completion is ambiguous (in-progress run)', async () => {
    const baseNow = Date.parse('2026-06-01T12:00:00.000Z');
    const jobs = new MockEc2AsyncJobRepository();
    const awsAccounts = new MockAwsAccountRepository();
    const cloudRepo = new MockEc2CloudResourceRepository();
    await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');
    const job = await seedQueuedJob(jobs, 'job-ambiguous', 'idem-ambiguous');
    await cloudRepo.createRun({
      runId: ec2AsyncJobDiscoveryRunId(job.jobId),
      tenantId: TENANT,
      accountId: ACCOUNT,
      requestedRegions: ['us-east-1'],
      startedAt: new Date(baseNow).toISOString(),
      leaseExpiresAt: computeLeaseExpiresAtIso(baseNow),
      executionOwnerId: 'async:job-ambiguous:discovery:attempt:1',
      attemptCount: 1,
    });
    await jobs.updateJob(
      TENANT,
      job.jobId,
      { status: 'RUNNING', stage: 'DISCOVERY', startedAt: new Date().toISOString() },
      { expectedVersion: job.version },
    );
    const discoveryCalls = { count: 0 };
    const consumer = createConsumer({
      jobs,
      awsAccounts,
      cloudRepo,
      discoveryCalls,
      nowMs: () => baseNow,
    });
    const outcome = await consumer.processValidatedMessage(messageForJob(job.jobId), 'req-amb');
    assert.equal(outcome, 'retry');
    assert.equal(discoveryCalls.count, 0);
  });

  it('recovers security analysis from persisted run without re-executing security service', async () => {
    const jobs = new MockEc2AsyncJobRepository();
    const awsAccounts = new MockAwsAccountRepository();
    const cloudRepo = new MockEc2CloudResourceRepository();
    const costRepo = new MockEc2CostRepository();
    const securityRepo = new MockEc2SecurityRepository();
    await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');
    const job = await seedQueuedJob(jobs, 'job-sec-recover', 'idem-sec-recover');
    const runId = ec2AsyncJobSecurityRunId(job.jobId);
    const startedAt = new Date().toISOString();
    const run = await securityRepo.createRun({
      runId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      startedAt,
    });
    await securityRepo.completeRun({
      tenantId: TENANT,
      accountId: ACCOUNT,
      runId,
      expectedVersion: run.version,
      status: 'SUCCEEDED',
      completedAt: startedAt,
      instancesFound: 0,
      instancesAnalyzed: 0,
      findingsCreated: 0,
      findingsUpdated: 0,
      findingsResolved: 0,
    });
    await jobs.updateJob(
      TENANT,
      job.jobId,
      { status: 'RUNNING', stage: 'SECURITY_ANALYSIS', startedAt },
      { expectedVersion: job.version },
    );
    const securityCalls = { count: 0 };
    const consumer = createConsumer({
      jobs,
      awsAccounts,
      cloudRepo,
      costRepo,
      securityRepo,
      securityCalls,
    });
    await consumer.processValidatedMessage(messageForJob(job.jobId), 'req-sec-recover');
    assert.equal(securityCalls.count, 0);
    const updated = await jobs.getJob(TENANT, job.jobId);
    assert.notEqual(updated?.stage, 'SECURITY_ANALYSIS');
  });

  it('completes FINALIZING from durable prior stages without re-running engines', async () => {
    const jobs = new MockEc2AsyncJobRepository();
    const awsAccounts = new MockAwsAccountRepository();
    const cloudRepo = new MockEc2CloudResourceRepository();
    const costRepo = new MockEc2CostRepository();
    const securityRepo = new MockEc2SecurityRepository();
    await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');
    const job = await seedQueuedJob(jobs, 'job-final-recover', 'idem-final-recover');
    const startedAt = new Date().toISOString();

    async function completeDiscoveryRun(runId: string) {
      const run = await cloudRepo.createRun({
        runId,
        tenantId: TENANT,
        accountId: ACCOUNT,
        requestedRegions: ['us-east-1'],
        startedAt,
      });
      await cloudRepo.completeRun({
        tenantId: TENANT,
        accountId: ACCOUNT,
        runId,
        expectedVersion: run.version,
        status: 'SUCCEEDED',
        completedAt: startedAt,
        resourceCounts: {},
        regionsSucceeded: ['us-east-1'],
        regionsFailed: [],
        warnings: [],
      });
    }

    async function completeCostRun(runId: string) {
      const run = await costRepo.createRun({
        runId,
        tenantId: TENANT,
        accountId: ACCOUNT,
        regions: ['us-east-1'],
        observationDays: 14,
        periodSeconds: 3600,
        requestedAt: startedAt,
        startedAt,
      });
      await costRepo.completeRun({
        tenantId: TENANT,
        accountId: ACCOUNT,
        runId,
        expectedVersion: run.version,
        status: 'SUCCEEDED',
        completedAt: startedAt,
        instancesFound: 0,
        instancesEvaluated: 0,
        recommendationsCreated: 0,
        recommendationsUpdated: 0,
        recommendationsResolved: 0,
        insufficientDataCount: 0,
        regionsSucceeded: ['us-east-1'],
        regionsFailed: [],
        warnings: [],
      });
    }

    async function completeSecurityRun(runId: string) {
      const run = await securityRepo.createRun({
        runId,
        tenantId: TENANT,
        accountId: ACCOUNT,
        regions: ['us-east-1'],
        startedAt,
      });
      await securityRepo.completeRun({
        tenantId: TENANT,
        accountId: ACCOUNT,
        runId,
        expectedVersion: run.version,
        status: 'SUCCEEDED',
        completedAt: startedAt,
        instancesFound: 0,
        instancesAnalyzed: 0,
        findingsCreated: 0,
        findingsUpdated: 0,
        findingsResolved: 0,
      });
    }

    await completeDiscoveryRun(ec2AsyncJobDiscoveryRunId(job.jobId));
    await completeCostRun(ec2AsyncJobCostRunId(job.jobId));
    await completeSecurityRun(ec2AsyncJobSecurityRunId(job.jobId));

    await jobs.updateJob(
      TENANT,
      job.jobId,
      { status: 'RUNNING', stage: 'FINALIZING', startedAt },
      { expectedVersion: job.version },
    );

    const discoveryCalls = { count: 0 };
    const costCalls = { count: 0 };
    const securityCalls = { count: 0 };
    const consumer = createConsumer({
      jobs,
      awsAccounts,
      cloudRepo,
      costRepo,
      securityRepo,
      discoveryCalls,
      costCalls,
      securityCalls,
    });
    const outcome = await consumer.processValidatedMessage(
      messageForJob(job.jobId),
      'req-final-recover',
    );
    assert.equal(outcome, 'ack');
    assert.equal(discoveryCalls.count, 0);
    assert.equal(costCalls.count, 0);
    assert.equal(securityCalls.count, 0);
    const finished = await jobs.getJob(TENANT, job.jobId);
    assert.equal(finished?.status, 'SUCCEEDED');
    assert.equal(finished?.stage, 'COMPLETE');
  });

  it('returns retry when concurrent recovery advances collide on expectedVersion', async () => {
    const jobs = new MockEc2AsyncJobRepository();
    const awsAccounts = new MockAwsAccountRepository();
    const cloudRepo = new MockEc2CloudResourceRepository();
    await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');
    const job = await seedQueuedJob(jobs, 'job-race-recover', 'idem-race-recover');
    const runId = ec2AsyncJobDiscoveryRunId(job.jobId);
    const startedAt = new Date().toISOString();
    const run = await cloudRepo.createRun({
      runId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      requestedRegions: ['us-east-1'],
      startedAt,
    });
    await cloudRepo.completeRun({
      tenantId: TENANT,
      accountId: ACCOUNT,
      runId,
      expectedVersion: run.version,
      status: 'SUCCEEDED',
      completedAt: startedAt,
      resourceCounts: {},
      regionsSucceeded: ['us-east-1'],
      regionsFailed: [],
      warnings: [],
    });
    await jobs.updateJob(
      TENANT,
      job.jobId,
      { status: 'RUNNING', stage: 'DISCOVERY', startedAt },
      { expectedVersion: job.version },
    );
    const discoveryCalls = { count: 0 };
    const consumer = createConsumer({ jobs, awsAccounts, cloudRepo, discoveryCalls });

    const [first, second] = await Promise.all([
      consumer.processValidatedMessage(messageForJob(job.jobId), 'req-race-a'),
      consumer.processValidatedMessage(messageForJob(job.jobId), 'req-race-b'),
    ]);

    assert.equal(discoveryCalls.count, 0);
    assert.ok(
      (first === 'ack' && second === 'retry') || (first === 'retry' && second === 'ack'),
    );
    const updated = await jobs.getJob(TENANT, job.jobId);
    assert.notEqual(updated?.stage, 'DISCOVERY');
  });

  it('marks unverified account jobs FAILED and acknowledges without retry', async () => {
    const jobs = new MockEc2AsyncJobRepository();
    const awsAccounts = new MockAwsAccountRepository();
    await awsAccounts.create({
      tenantId: TENANT,
      accountId: ACCOUNT,
      roleArn: `arn:aws:iam::${ACCOUNT}:role/SisumReadOnlyIntegrationRole`,
      externalId: 'ext-test-value-never-logged',
      region: 'us-east-1',
      status: 'PENDING',
      verificationStatus: 'NOT_STARTED',
      metadata: {},
    });
    const job = await seedQueuedJob(jobs, 'job-unverified', 'idem-unverified');
    const discoveryCalls = { count: 0 };
    const consumer = createConsumer({ jobs, awsAccounts, discoveryCalls });
    const outcome = await consumer.processValidatedMessage(
      messageForJob(job.jobId),
      'req-unverified',
    );
    assert.equal(outcome, 'ack');
    assert.equal(discoveryCalls.count, 0);
    const updated = await jobs.getJob(TENANT, job.jobId);
    assert.equal(updated?.status, 'FAILED');
    assert.ok(updated?.completedAt);
  });

  it('reclaims stale RUNNING discovery and executes exactly once', async () => {
    const baseNow = Date.parse('2026-06-01T12:00:00.000Z');
    const jobs = new MockEc2AsyncJobRepository();
    const awsAccounts = new MockAwsAccountRepository();
    const cloudRepo = new MockEc2CloudResourceRepository();
    await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');
    const job = await seedQueuedJob(jobs, 'job-stale', 'idem-stale');
    const runId = ec2AsyncJobDiscoveryRunId(job.jobId);
    await cloudRepo.createRun({
      runId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      requestedRegions: ['us-east-1'],
      startedAt: new Date(baseNow - 720_000).toISOString(),
      leaseExpiresAt: new Date(baseNow - 60_000).toISOString(),
      executionOwnerId: 'async:job-stale:discovery:attempt:1',
      attemptCount: 1,
    });
    await jobs.updateJob(
      TENANT,
      job.jobId,
      { status: 'RUNNING', stage: 'DISCOVERY', startedAt: new Date(baseNow).toISOString() },
      { expectedVersion: job.version },
    );
    const discoveryCalls = { count: 0 };
    const consumer = createConsumer({
      jobs,
      awsAccounts,
      cloudRepo,
      discoveryCalls,
      nowMs: () => baseNow,
    });
    await consumer.processValidatedMessage(messageForJob(job.jobId), 'req-stale');
    assert.equal(discoveryCalls.count, 1);
    const run = await cloudRepo.getRun(TENANT, ACCOUNT, runId);
    assert.equal(run?.attemptCount, 2);
  });

  it('retries retryable FAILED discovery without createRun conflict', async () => {
    const baseNow = Date.parse('2026-06-01T12:00:00.000Z');
    const jobs = new MockEc2AsyncJobRepository();
    const awsAccounts = new MockAwsAccountRepository();
    const cloudRepo = new MockEc2CloudResourceRepository();
    await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');
    const job = await seedQueuedJob(jobs, 'job-failed-retry', 'idem-failed-retry');
    const runId = ec2AsyncJobDiscoveryRunId(job.jobId);
    const startedAt = new Date(baseNow - 120_000).toISOString();
    const run = await cloudRepo.createRun({
      runId,
      tenantId: TENANT,
      accountId: ACCOUNT,
      requestedRegions: ['us-east-1'],
      startedAt,
      attemptCount: 1,
    });
    await cloudRepo.completeRun({
      tenantId: TENANT,
      accountId: ACCOUNT,
      runId,
      expectedVersion: run.version,
      status: 'FAILED',
      completedAt: startedAt,
      resourceCounts: {},
      regionsSucceeded: [],
      regionsFailed: ['us-east-1'],
      warnings: ['transient'],
      failureRetryable: true,
    });
    await jobs.updateJob(
      TENANT,
      job.jobId,
      { status: 'RUNNING', stage: 'DISCOVERY', startedAt },
      { expectedVersion: job.version },
    );
    const discoveryCalls = { count: 0 };
    const consumer = createConsumer({
      jobs,
      awsAccounts,
      cloudRepo,
      discoveryCalls,
      nowMs: () => baseNow,
    });
    await consumer.processValidatedMessage(messageForJob(job.jobId), 'req-failed-retry');
    assert.equal(discoveryCalls.count, 1);
    const after = await cloudRepo.getRun(TENANT, ACCOUNT, runId);
    assert.ok((after?.attemptCount ?? 0) >= 2);
    assert.equal(after?.status, 'SUCCEEDED');
  });
});

describe('EC2 analysis consumer SAM template', () => {
  const template = readFileSync(path.join(__dirname, '../../template.yaml'), 'utf8');

  it('defines SisumEc2AnalysisConsumerFunction on the existing queue', () => {
    assert.match(template, /SisumEc2AnalysisConsumerFunction:/);
    assert.match(template, /Queue: !GetAtt SisumEc2IntelligenceQueue\.Arn/);
    assert.match(template, /ReportBatchItemFailures/);
  });

  it('keeps existing DLQ redrive settings unchanged', () => {
    assert.match(template, /maxReceiveCount: 5/);
    assert.match(template, /SisumEc2IntelligenceDlq:/);
  });

  it('scopes consumer SQS IAM to the work queue', () => {
    const section = template.slice(
      template.indexOf('SisumEc2IntelligenceQueueConsumePolicy'),
      template.indexOf('SisumStsAssumeRolePolicy'),
    );
    assert.match(section, /sqs:ReceiveMessage/);
    assert.match(section, /Resource: !GetAtt SisumEc2IntelligenceQueue\.Arn/);
    assert.doesNotMatch(section, /sqs:\*/);
  });

  it('keeps producer SendMessage-only policy separate from consumer policy', () => {
    const sendStart = template.indexOf('SisumEc2IntelligenceQueueSendPolicy');
    const producer = template.slice(
      sendStart,
      template.indexOf('SisumEc2IntelligenceQueueConsumePolicy', sendStart),
    );
    assert.match(producer, /sqs:SendMessage/);
    assert.doesNotMatch(producer, /ReceiveMessage/);
    assert.match(producer, /SisumLambdaExecutionRole/);
  });

  it('assigns a dedicated execution role to the consumer Lambda', () => {
    const consumerSection = template.slice(
      template.indexOf('SisumEc2AnalysisConsumerFunction'),
      template.indexOf('Outputs:'),
    );
    assert.match(consumerSection, /Role: !GetAtt SisumEc2AnalysisConsumerExecutionRole\.Arn/);
    assert.doesNotMatch(consumerSection, /SisumLambdaExecutionRole/);
  });

  it('configures safe Lambda timeout and queue visibility timeout', () => {
    const queueSection = template.slice(
      template.indexOf('SisumEc2IntelligenceQueue:'),
      template.indexOf('SisumBusinessPersistencePolicy'),
    );
    assert.match(queueSection, new RegExp(`VisibilityTimeout: ${EC2_INTELLIGENCE_QUEUE_VISIBILITY_TIMEOUT_SECONDS}`));
    const consumerSection = template.slice(
      template.indexOf('SisumEc2AnalysisConsumerFunction'),
      template.indexOf('Outputs:'),
    );
    assert.match(consumerSection, new RegExp(`Timeout: ${EC2_ANALYSIS_CONSUMER_LAMBDA_TIMEOUT_SECONDS}`));
    assert.ok(
      EC2_INTELLIGENCE_QUEUE_VISIBILITY_TIMEOUT_SECONDS >=
        EC2_ANALYSIS_CONSUMER_LAMBDA_TIMEOUT_SECONDS * 6,
    );
  });

  it('does not attach consumer SQS consume policy to SisumLambdaExecutionRole', () => {
    const consumeStart = template.indexOf('SisumEc2IntelligenceQueueConsumePolicy');
    const consumeSection = template.slice(
      consumeStart,
      template.indexOf('SisumStsAssumeRolePolicy', consumeStart),
    );
    assert.match(consumeSection, /SisumEc2AnalysisConsumerExecutionRole/);
    assert.doesNotMatch(consumeSection, /SisumLambdaExecutionRole/);
  });

  it('assigns API Lambda to SisumLambdaExecutionRole (effective SQS send only at policy level)', () => {
    const apiSection = template.slice(
      template.indexOf('SisumBackendFunction:'),
      template.indexOf('SisumEc2AnalysisConsumerLogGroup'),
    );
    assert.match(apiSection, /Role: !Sub "arn:\$\{AWS::Partition\}:iam::\$\{AWS::AccountId\}:role\/SisumLambdaExecutionRole"/);
  });
});
