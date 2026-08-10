/**
 * Presentation-only helpers when persisted job status diverges from scope blocking.
 */

import type { Ec2AsyncJob, Ec2AsyncJobStage, Ec2AsyncJobStatus } from '../api/ec2-async-job-types';

export function isEc2AsyncJobPersistedNonTerminal(
  job: Pick<Ec2AsyncJob, 'status' | 'stage'>,
): boolean {
  if (job.status === 'QUEUED' || job.status === 'RUNNING') {
    return true;
  }
  if (job.status === 'PARTIAL' && job.stage !== 'COMPLETE') {
    return true;
  }
  return false;
}

/** Backend says this row no longer blocks same-scope start; execution may still show RUNNING in DDB. */
export function isEc2AsyncJobExecutionNoLongerActive(job: Ec2AsyncJob): boolean {
  return job.isScopeBlocking === false && isEc2AsyncJobPersistedNonTerminal(job);
}

export function formatPersistedStatusLabel(status: Ec2AsyncJobStatus, stage: Ec2AsyncJobStage): string {
  if (status === 'PARTIAL' && stage === 'COMPLETE') {
    return 'PARTIAL (complete)';
  }
  return stage && status === 'RUNNING' ? `${status} · ${stage}` : status;
}

export const EC2_EXECUTION_NO_LONGER_ACTIVE_NOTE =
  'Execution: No longer active (same-scope analysis may be started).';
