import { InvalidPaginationTokenError, RepositoryNotFoundError } from '../database';
import type { Ec2AsyncJobRepository } from '../repositories/contracts/ec2-async-job-repository';
import type { Ec2AsyncJobRecord, Ec2AsyncJobEventRecord } from '../async-jobs/ec2-async-job-models';
import type { PageResult } from '../repositories/contracts/repository-types';
import type { Ec2AsyncJobStageCompletionService } from './ec2-async-job-stage-completion';
import { isEc2AsyncJobActive } from './ec2-async-job-active';
import { isEc2AsyncJobBlockingSameScopeStart } from './ec2-async-job-scope-blocker';

export function sanitizeEc2AsyncJobForApi(
  job: Ec2AsyncJobRecord,
  options?: {
    /**
     * When set, means this job currently prevents starting another analysis for the
     * same account/regions scope (POST /analysis/ec2/start duplicate guard).
     * Not equivalent to persisted status RUNNING and not a health indicator.
     */
    isScopeBlocking?: boolean;
  },
) {
  return {
    jobId: job.jobId,
    accountId: job.accountId,
    regions: job.regions,
    jobType: job.jobType,
    status: job.status,
    queueStatus: job.queueStatus,
    stage: job.stage,
    correlationId: job.correlationId,
    retryCount: job.retryCount,
    errorSummary: job.errorSummary,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    version: job.version,
    ...(options?.isScopeBlocking !== undefined
      ? { isScopeBlocking: options.isScopeBlocking }
      : {}),
  };
}

export function sanitizeEc2AsyncJobEventForApi(event: Ec2AsyncJobEventRecord) {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    timestamp: event.timestamp,
    status: event.status,
    queueStatus: event.queueStatus,
    stage: event.stage,
    correlationId: event.correlationId,
    errorSummary: event.errorSummary,
  };
}

export class Ec2AsyncJobApiService {
  constructor(
    private readonly jobs: Ec2AsyncJobRepository,
    private readonly stageCompletion?: Ec2AsyncJobStageCompletionService,
  ) {}

  async presentJobForApi(job: Ec2AsyncJobRecord) {
    if (!this.stageCompletion) {
      return sanitizeEc2AsyncJobForApi(job);
    }
    if (!isEc2AsyncJobActive(job)) {
      return sanitizeEc2AsyncJobForApi(job, { isScopeBlocking: false });
    }
    const isScopeBlocking = await isEc2AsyncJobBlockingSameScopeStart(
      job,
      this.stageCompletion,
    );
    return sanitizeEc2AsyncJobForApi(job, { isScopeBlocking });
  }

  async getJob(tenantId: string, jobId: string): Promise<Ec2AsyncJobRecord> {
    const job = await this.jobs.getJob(tenantId, jobId);
    if (!job) {
      throw new RepositoryNotFoundError('EC2 intelligence job not found.');
    }
    return job;
  }

  async listJobs(
    tenantId: string,
    page?: { limit?: number; nextToken?: string },
  ): Promise<PageResult<Ec2AsyncJobRecord>> {
    try {
      return await this.jobs.listJobsByTenant(tenantId, page);
    } catch (error) {
      if (error instanceof InvalidPaginationTokenError) {
        throw error;
      }
      throw error;
    }
  }

  async listEvents(
    tenantId: string,
    jobId: string,
    page?: { limit?: number; nextToken?: string },
  ): Promise<PageResult<Ec2AsyncJobEventRecord>> {
    await this.getJob(tenantId, jobId);
    return this.jobs.listEvents(tenantId, jobId, page);
  }
}
