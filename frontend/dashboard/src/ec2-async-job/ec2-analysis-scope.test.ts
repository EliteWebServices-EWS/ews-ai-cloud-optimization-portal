import { describe, it, expect } from 'vitest';
import type { Ec2AsyncJob } from '../api/ec2-async-job-types';
import type { ReportListItem } from '../types';
import {
  buildEc2AnalysisScopeKey,
  findActiveEc2AnalysisJobForScope,
  pickLatestEc2AnalysisJobsByScope,
  pickLatestEc2ReportsByScope,
} from './ec2-analysis-scope';

function job(
  overrides: Partial<Ec2AsyncJob> & Pick<Ec2AsyncJob, 'jobId' | 'createdAt'>,
): Ec2AsyncJob {
  return {
    accountId: '572262081497',
    regions: ['us-east-1'],
    jobType: 'EC2_INTELLIGENCE',
    status: 'SUCCEEDED',
    queueStatus: 'ENQUEUED',
    stage: 'COMPLETE',
    correlationId: 'c1',
    retryCount: 0,
    version: 1,
    ...overrides,
  };
}

describe('ec2-analysis-scope', () => {
  it('normalizes region order for scope identity', () => {
    expect(
      buildEc2AnalysisScopeKey({ accountId: '1', regions: ['us-west-2', 'us-east-1'] }),
    ).toBe(buildEc2AnalysisScopeKey({ accountId: '1', regions: ['us-east-1', 'us-west-2'] }));
  });

  it('picks newest job per scope', () => {
    const jobs = [
      job({ jobId: 'old', createdAt: '2026-08-09T12:00:00.000Z', status: 'SUCCEEDED', stage: 'COMPLETE' }),
      job({ jobId: 'new', createdAt: '2026-08-10T06:56:00.000Z', status: 'SUCCEEDED', stage: 'COMPLETE' }),
      job({
        jobId: 'fail-new',
        createdAt: '2026-08-10T07:00:00.000Z',
        status: 'FAILED',
        stage: 'DISCOVERY',
      }),
    ];
    const latest = pickLatestEc2AnalysisJobsByScope(jobs);
    expect(latest).toHaveLength(1);
    expect(latest[0]?.jobId).toBe('fail-new');
  });

  it('does not substitute older success when latest failed', () => {
    const jobs = [
      job({ jobId: 'success-old', createdAt: '2026-08-09T12:00:00.000Z' }),
      job({
        jobId: 'failed-new',
        createdAt: '2026-08-10T06:56:00.000Z',
        status: 'FAILED',
        stage: 'DISCOVERY',
      }),
    ];
    expect(pickLatestEc2AnalysisJobsByScope(jobs)[0]?.jobId).toBe('failed-new');
  });

  it('finds active job for matching scope', () => {
    const jobs = [
      job({ jobId: 'done', createdAt: '2026-08-09T12:00:00.000Z' }),
      job({
        jobId: 'running',
        createdAt: '2026-08-10T06:56:00.000Z',
        status: 'RUNNING',
        stage: 'DISCOVERY',
      }),
    ];
    const active = findActiveEc2AnalysisJobForScope(jobs, {
      accountId: '572262081497',
      regions: ['us-east-1'],
    });
    expect(active?.jobId).toBe('running');
  });

  it('groups reports by account and regions', () => {
    const reports: ReportListItem[] = [
      {
        reportId: 'r-old',
        workflowId: 'ec2-async:j1',
        plugin: 'ec2',
        status: 'complete',
        workflowStatus: 'completed',
        createdAt: '2026-08-09T12:00:00.000Z',
        region: 'us-east-1',
        reportSource: 'ec2_async',
        accountId: '572262081497',
        regions: ['us-east-1'],
        summary: {
          headline: 'old',
          opportunityCount: 0,
          estimatedMonthlySavings: 0,
          verifiedMonthlySavings: 0,
          verifiedCount: 0,
          currency: 'USD',
          optimizationStatus: 'complete',
          executiveSummary: '',
        },
        resourceCount: 0,
      },
      {
        reportId: 'r-new',
        workflowId: 'ec2-async:j2',
        plugin: 'ec2',
        status: 'complete',
        workflowStatus: 'completed',
        createdAt: '2026-08-10T06:56:00.000Z',
        region: 'us-east-1',
        reportSource: 'ec2_async',
        accountId: '572262081497',
        regions: ['us-east-1'],
        summary: {
          headline: 'new',
          opportunityCount: 0,
          estimatedMonthlySavings: 0,
          verifiedMonthlySavings: 0,
          verifiedCount: 0,
          currency: 'USD',
          optimizationStatus: 'complete',
          executiveSummary: '',
        },
        resourceCount: 0,
      },
    ];
    expect(pickLatestEc2ReportsByScope(reports)[0]?.reportId).toBe('r-new');
  });
});
