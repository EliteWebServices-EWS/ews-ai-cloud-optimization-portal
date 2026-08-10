import type { Ec2AsyncJobRecord } from '../async-jobs/ec2-async-job-models';

/** Non-terminal jobs that should block duplicate concurrent analysis for the same scope. */
export function isEc2AsyncJobActive(
  job: Pick<Ec2AsyncJobRecord, 'status' | 'stage' | 'queueStatus'>,
): boolean {
  if (job.queueStatus === 'ENQUEUE_FAILED') {
    return false;
  }
  if (job.status === 'QUEUED' || job.status === 'RUNNING') {
    return true;
  }
  if (job.status === 'PARTIAL' && job.stage !== 'COMPLETE') {
    return true;
  }
  return false;
}
