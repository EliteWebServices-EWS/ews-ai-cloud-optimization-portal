/**
 * Heuristics for EC2 async jobs that are no longer actively processing.
 */

import type { Ec2AsyncJob } from '../api/ec2-async-job-types';
import {
  mapEc2AsyncJobToDisplayState,
  type Ec2AsyncJobDisplayState,
} from './ec2-async-job-status-mapping';
import {
  formatPersistedStatusLabel,
  isEc2AsyncJobExecutionNoLongerActive,
} from './ec2-async-job-execution-presentation';

/** Align with backend/async-jobs/ec2-intelligence-processing-limits.ts and SQS redrive. */
export const EC2_ASYNC_JOB_SQS_MAX_RECEIVE_COUNT = 5;

/**
 * History-only heuristic for jobs left RUNNING after worker/queue exhaustion.
 * Does not mutate backend status.
 */
export function isEc2AsyncJobHistoryAbandoned(
  job: Pick<Ec2AsyncJob, 'jobId' | 'status' | 'retryCount' | 'errorSummary'>,
  options?: { activeJobId?: string | null },
): boolean {
  if (job.status !== 'RUNNING') {
    return false;
  }
  if (options?.activeJobId && options.activeJobId === job.jobId) {
    return false;
  }
  if (job.retryCount >= EC2_ASYNC_JOB_SQS_MAX_RECEIVE_COUNT) {
    return true;
  }
  return job.retryCount >= 3 && Boolean(job.errorSummary?.trim());
}

export function mapEc2AsyncJobHistoryDisplay(
  job: Ec2AsyncJob,
  options?: { activeJobId?: string | null; localStarting?: boolean },
): Ec2AsyncJobDisplayState & { historyStatusDetail?: string } {
  if (isEc2AsyncJobExecutionNoLongerActive(job)) {
    const base = mapEc2AsyncJobToDisplayState(job.status, job.stage, {
      localStarting: options?.localStarting,
    });
    return {
      ...base,
      historyStatusDetail: `Persisted: ${formatPersistedStatusLabel(job.status, job.stage)}. Execution inactive.`,
    };
  }
  if (isEc2AsyncJobHistoryAbandoned(job, options)) {
    return {
      label: 'Failed',
      milestonePercent: 100,
      terminal: true,
      failed: true,
      succeeded: false,
    };
  }
  return mapEc2AsyncJobToDisplayState(job.status, job.stage, {
    localStarting: options?.localStarting,
  });
}
