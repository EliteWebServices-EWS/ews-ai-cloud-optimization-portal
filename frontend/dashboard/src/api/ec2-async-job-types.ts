/**
 * Sanitized EC2 async job shapes returned by the backend API (browser-safe).
 */

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

export interface Ec2AsyncJob {
  jobId: string;
  accountId: string;
  regions: string[];
  jobType: string;
  status: Ec2AsyncJobStatus;
  queueStatus: Ec2AsyncQueueStatus;
  stage: Ec2AsyncJobStage;
  correlationId: string;
  retryCount: number;
  errorSummary?: string;
  /**
   * Backend: this job blocks starting another same-scope analysis. Not persisted status;
   * false does not mean SUCCEEDED/FAILED.
   */
  isScopeBlocking?: boolean;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  version: number;
}

export interface Ec2AsyncJobEvent {
  eventId: string;
  eventType: string;
  timestamp: string;
  status?: Ec2AsyncJobStatus;
  queueStatus?: Ec2AsyncQueueStatus;
  stage?: Ec2AsyncJobStage;
  correlationId: string;
  errorSummary?: string;
}

export interface Ec2AsyncJobStartResult {
  jobId: string;
  status: Ec2AsyncJobStatus;
  queueStatus: Ec2AsyncQueueStatus;
  correlationId: string;
}

export interface Ec2AsyncJobListPage {
  items: Ec2AsyncJob[];
  nextToken?: string;
}

export interface Ec2AsyncJobEventsPage {
  items: Ec2AsyncJobEvent[];
  nextToken?: string;
}

export interface StartEc2AnalysisRequest {
  accountId: string;
  regions?: string[];
}
