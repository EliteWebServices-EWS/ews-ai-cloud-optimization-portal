import { describe, expect, it } from 'vitest';

import {
  formatPersistedStatusLabel,
  isEc2AsyncJobExecutionNoLongerActive,
  isEc2AsyncJobPersistedNonTerminal,
} from './ec2-async-job-execution-presentation';
import type { Ec2AsyncJob } from '../api/ec2-async-job-types';

function job(overrides: Partial<Ec2AsyncJob> = {}): Ec2AsyncJob {
  return {
    jobId: 'job-1',
    accountId: '572262081497',
    regions: ['us-east-1'],
    jobType: 'ec2_intelligence',
    status: 'RUNNING',
    queueStatus: 'ENQUEUED',
    stage: 'DISCOVERY',
    correlationId: 'c1',
    retryCount: 0,
    createdAt: '2026-08-09T16:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

describe('ec2-async-job-execution-presentation', () => {
  it('treats PARTIAL COMPLETE as terminal persisted shape', () => {
    expect(
      isEc2AsyncJobPersistedNonTerminal({ status: 'PARTIAL', stage: 'COMPLETE' }),
    ).toBe(false);
  });

  it('execution inactive when backend sets isScopeBlocking false on RUNNING', () => {
    expect(isEc2AsyncJobExecutionNoLongerActive(job({ isScopeBlocking: false }))).toBe(true);
  });

  it('does not treat isScopeBlocking false on SUCCEEDED as execution inactive', () => {
    expect(
      isEc2AsyncJobExecutionNoLongerActive(
        job({ status: 'SUCCEEDED', stage: 'COMPLETE', isScopeBlocking: false }),
      ),
    ).toBe(false);
  });

  it('formatPersistedStatusLabel includes stage for RUNNING', () => {
    expect(formatPersistedStatusLabel('RUNNING', 'DISCOVERY')).toContain('RUNNING');
    expect(formatPersistedStatusLabel('RUNNING', 'DISCOVERY')).toContain('DISCOVERY');
  });
});
