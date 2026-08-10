import type { PageRequest, PageResult, UpdateOptions } from './repository-types';
import type {
  Ec2AsyncJobEventRecord,
  Ec2AsyncJobRecord,
} from '../../async-jobs/ec2-async-job-models';

export interface CreateEc2AsyncJobInput {
  tenantId: string;
  jobId: string;
  accountId: string;
  regions: string[];
  jobType: Ec2AsyncJobRecord['jobType'];
  correlationId: string;
  idempotencyKey: string;
  requestFingerprint: string;
}

export interface UpdateEc2AsyncJobInput {
  status?: Ec2AsyncJobRecord['status'];
  queueStatus?: Ec2AsyncJobRecord['queueStatus'];
  stage?: Ec2AsyncJobRecord['stage'];
  retryCount?: number;
  errorSummary?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AppendEc2AsyncJobEventInput {
  tenantId: string;
  jobId: string;
  eventType: string;
  correlationId: string;
  status?: Ec2AsyncJobRecord['status'];
  queueStatus?: Ec2AsyncJobRecord['queueStatus'];
  stage?: Ec2AsyncJobRecord['stage'];
  errorSummary?: string;
}

export interface Ec2AsyncJobRepository {
  createIdempotentJob(input: CreateEc2AsyncJobInput): Promise<Ec2AsyncJobRecord>;

  getJob(tenantId: string, jobId: string): Promise<Ec2AsyncJobRecord | undefined>;

  updateJob(
    tenantId: string,
    jobId: string,
    changes: UpdateEc2AsyncJobInput,
    options: UpdateOptions,
  ): Promise<Ec2AsyncJobRecord>;

  listJobsByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<Ec2AsyncJobRecord>>;

  appendEvent(input: AppendEc2AsyncJobEventInput): Promise<Ec2AsyncJobEventRecord>;

  listEvents(
    tenantId: string,
    jobId: string,
    page?: PageRequest,
  ): Promise<PageResult<Ec2AsyncJobEventRecord>>;

  findNewestActiveJobByRequestFingerprint(
    tenantId: string,
    requestFingerprint: string,
  ): Promise<Ec2AsyncJobRecord | undefined>;

  getIdempotencyJobId(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<{ jobId: string; requestFingerprint: string } | undefined>;
}
