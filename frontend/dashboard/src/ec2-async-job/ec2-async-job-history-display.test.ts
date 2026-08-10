import { describe, expect, it } from 'vitest';

import type { Ec2AsyncJob } from '../api/ec2-async-job-types';
import {
  isEc2AsyncJobHistoryAbandoned,
  mapEc2AsyncJobHistoryDisplay,
} from './ec2-async-job-history-display';

function job(partial: Partial<Ec2AsyncJob> & Pick<Ec2AsyncJob, 'jobId'>): Ec2AsyncJob {
  return {
    accountId: '111122223333',
    regions: ['us-east-1'],
    jobType: 'EC2_INTELLIGENCE',
    status: 'RUNNING',
    queueStatus: 'ENQUEUED',
    stage: 'DISCOVERY',
    correlationId: 'corr',
    retryCount: 0,
    createdAt: '2026-08-09T00:00:00.000Z',
    version: 1,
    ...partial,
  };
}

describe('ec2-async-job history display', () => {
  it('marks abandoned RUNNING jobs in history as Failed', () => {
    const stalled = job({
      jobId: 'job-stalled',
      retryCount: 3,
      errorSummary: 'Error: processing failed.',
    });
    expect(isEc2AsyncJobHistoryAbandoned(stalled)).toBe(true);
    const display = mapEc2AsyncJobHistoryDisplay(stalled);
    expect(display.label).toBe('Failed');
    expect(display.failed).toBe(true);
  });

  it('does not mark the actively polled job as abandoned', () => {
    const active = job({
      jobId: 'job-active',
      retryCount: 3,
      errorSummary: 'Error: processing failed.',
    });
    expect(isEc2AsyncJobHistoryAbandoned(active, { activeJobId: 'job-active' })).toBe(false);
  });

  it('maps SUCCEEDED jobs to Completed', () => {
    const completed = job({
      jobId: 'job-ok',
      status: 'SUCCEEDED',
      stage: 'COMPLETE',
    });
    const display = mapEc2AsyncJobHistoryDisplay(completed);
    expect(display.label).toBe('Completed');
    expect(display.succeeded).toBe(true);
  });
});
