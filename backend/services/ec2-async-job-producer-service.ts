import { EC2_ASYNC_JOB_TYPE, buildEc2AsyncJobRequestFingerprint } from '../database/async-jobs';
import { RepositoryIdempotencyConflictError, RepositoryNotFoundError } from '../database';
import type { AwsAccountRepository } from '../repositories/contracts';
import type { Ec2AsyncJobRepository } from '../repositories/contracts/ec2-async-job-repository';
import { AppError } from '../shared/utils';
import { deriveIdempotentAsyncJobId } from '../shared/utils/response';
import {
  parseEc2CostAccountId,
} from '../api/ec2-cost-request-validators';
import {
  resolveEc2CostAnalysisRegions,
  type StartEc2CostAnalysisInput,
} from './ec2-cost-analysis-api-service';
import { Ec2CostValidationError } from './ec2-cost-analysis-api-service';
import { buildEc2IntelligenceQueueMessage } from '../async-jobs/ec2-intelligence-queue-message';
import {
  type Ec2IntelligenceQueueSender,
} from '../async-jobs/ec2-intelligence-queue-sender';
import type { Ec2AsyncJobRecord } from '../async-jobs/ec2-async-job-models';

export class Ec2AsyncJobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ec2AsyncJobValidationError';
  }
}

export interface StartEc2AsyncIntelligenceInput {
  accountId: string;
  regions?: string[];
}

export interface StartEc2AsyncIntelligenceResult {
  job: Ec2AsyncJobRecord;
  reused: boolean;
  enqueued: boolean;
}

const ENQUEUE_FAILED_SUMMARY =
  'The EC2 intelligence job could not be queued. Retry with the same Idempotency-Key.';

export class Ec2AsyncJobProducerService {
  constructor(
    private readonly awsAccounts: AwsAccountRepository,
    private readonly jobs: Ec2AsyncJobRepository,
    private readonly queue: Ec2IntelligenceQueueSender,
  ) {}

  async resolveVerifiedAccount(tenantId: string, accountId: string) {
    const normalizedAccountId = parseEc2CostAccountId(accountId);
    const record = await this.awsAccounts.getById(tenantId, normalizedAccountId);
    if (!record) {
      throw new RepositoryNotFoundError('AWS account connection not found.');
    }
    if (record.status !== 'VERIFIED') {
      throw new AppError(
        'AWS_ACCOUNT_NOT_VERIFIED',
        'AWS account must be VERIFIED before EC2 intelligence jobs.',
        409,
        'ec2-async-job-api',
      );
    }
    return record;
  }

  resolveRegions(input: StartEc2AsyncIntelligenceInput, defaultRegion: string): string[] {
    try {
      return resolveEc2CostAnalysisRegions(
        input as StartEc2CostAnalysisInput,
        defaultRegion,
      );
    } catch (error) {
      if (error instanceof Ec2CostValidationError) {
        throw new Ec2AsyncJobValidationError(error.message);
      }
      throw error;
    }
  }

  async startEc2IntelligenceJob(
    tenantId: string,
    input: StartEc2AsyncIntelligenceInput,
    context: { idempotencyKey: string; correlationId: string },
  ): Promise<StartEc2AsyncIntelligenceResult> {
    const account = await this.resolveVerifiedAccount(tenantId, input.accountId);
    const regions = this.resolveRegions(input, account.region);
    const requestFingerprint = buildEc2AsyncJobRequestFingerprint({
      accountId: account.accountId,
      regions,
      jobType: EC2_ASYNC_JOB_TYPE,
    });

    const activeJob = await this.jobs.findNewestActiveJobByRequestFingerprint(
      tenantId,
      requestFingerprint,
    );
    if (activeJob) {
      return {
        job: activeJob,
        reused: true,
        enqueued: activeJob.queueStatus === 'ENQUEUED',
      };
    }

    const jobId = deriveIdempotentAsyncJobId(tenantId, context.idempotencyKey);

    let job: Ec2AsyncJobRecord;
    let reused = false;
    try {
      job = await this.jobs.createIdempotentJob({
        tenantId,
        jobId,
        accountId: account.accountId,
        regions,
        jobType: EC2_ASYNC_JOB_TYPE,
        correlationId: context.correlationId,
        idempotencyKey: context.idempotencyKey,
        requestFingerprint,
      });
    } catch (error) {
      if (error instanceof RepositoryIdempotencyConflictError) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency-Key was reused with a different request.',
          409,
          'ec2-async-job-api',
        );
      }
      throw error;
    }

    if (job.queueStatus === 'ENQUEUED') {
      reused = true;
      return { job, reused, enqueued: true };
    }

    if (job.queueStatus === 'ENQUEUE_FAILED') {
      reused = true;
    }

    try {
      await this.queue.send(
        buildEc2IntelligenceQueueMessage({
          jobId: job.jobId,
          tenantId: job.tenantId,
          accountId: job.accountId,
          regions: job.regions,
          correlationId: job.correlationId,
        }),
      );
    } catch {
      job = await this.jobs.updateJob(
        tenantId,
        job.jobId,
        {
          queueStatus: 'ENQUEUE_FAILED',
          errorSummary: ENQUEUE_FAILED_SUMMARY,
        },
        { expectedVersion: job.version },
      );
      await this.jobs.appendEvent({
        tenantId,
        jobId: job.jobId,
        eventType: 'ec2.async_job.enqueue_failed',
        correlationId: context.correlationId,
        status: job.status,
        queueStatus: job.queueStatus,
        stage: job.stage,
        errorSummary: job.errorSummary,
      });
      throw new AppError(
        'EC2_ASYNC_JOB_ENQUEUE_FAILED',
        ENQUEUE_FAILED_SUMMARY,
        503,
        'ec2-async-job-api',
      );
    }

    job = await this.jobs.updateJob(
      tenantId,
      job.jobId,
      { queueStatus: 'ENQUEUED', errorSummary: undefined },
      { expectedVersion: job.version },
    );
    await this.jobs.appendEvent({
      tenantId,
      jobId: job.jobId,
      eventType: 'ec2.async_job.enqueued',
      correlationId: context.correlationId,
      status: job.status,
      queueStatus: job.queueStatus,
      stage: job.stage,
    });

    return { job, reused, enqueued: true };
  }
}
