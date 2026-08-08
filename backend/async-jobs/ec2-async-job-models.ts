import type { EC2_ASYNC_JOB_TYPE } from '../database/async-jobs';

export type Ec2AsyncJobType = typeof EC2_ASYNC_JOB_TYPE;

export type Ec2AsyncJobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';

export type Ec2AsyncQueueStatus = 'PENDING' | 'ENQUEUED' | 'ENQUEUE_FAILED';

export type Ec2AsyncJobStage =
  | 'ENQUEUE'
  | 'DISCOVERY'
  | 'COST_ANALYSIS'
  | 'SECURITY_ANALYSIS'
  | 'GOVERNANCE_ANALYSIS'
  | 'FINALIZING'
  | 'COMPLETE';

export interface Ec2AsyncJobRecord {
  tenantId: string;
  jobId: string;
  accountId: string;
  regions: string[];
  jobType: Ec2AsyncJobType;
  status: Ec2AsyncJobStatus;
  queueStatus: Ec2AsyncQueueStatus;
  stage: Ec2AsyncJobStage;
  correlationId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  retryCount: number;
  errorSummary?: string;
  startedAt?: string;
  completedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Ec2AsyncJobEventRecord {
  tenantId: string;
  jobId: string;
  eventId: string;
  eventType: string;
  timestamp: string;
  correlationId: string;
  status?: Ec2AsyncJobStatus;
  queueStatus?: Ec2AsyncQueueStatus;
  stage?: Ec2AsyncJobStage;
  errorSummary?: string;
}

export interface Ec2AsyncJobIdempotencyRecord {
  tenantId: string;
  idempotencyKey: string;
  jobId: string;
  requestFingerprint: string;
  createdAt: string;
}
