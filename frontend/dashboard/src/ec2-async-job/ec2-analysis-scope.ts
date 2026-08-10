/**
 * Authoritative EC2 analysis scope identity (tenant-scoped lists only).
 * Matches backend requestFingerprint inputs: accountId + sorted regions.
 */

import type { Ec2AsyncJob } from '../api/ec2-async-job-types';
import type { ReportListItem } from '../types';
import { isTerminalJobStatus } from './ec2-async-job-status-mapping';

export function normalizeEc2AnalysisRegions(regions: string[] | undefined): string[] {
  return [...(regions ?? [])].sort((a, b) => a.localeCompare(b));
}

export function buildEc2AnalysisScopeKey(input: {
  accountId: string;
  regions?: string[];
}): string {
  const regions = normalizeEc2AnalysisRegions(input.regions);
  return `${input.accountId}|${regions.join(',')}`;
}

export function buildEc2AnalysisScopeKeyFromJob(job: Pick<Ec2AsyncJob, 'accountId' | 'regions'>): string {
  return buildEc2AnalysisScopeKey(job);
}

export function buildEc2ReportScopeKey(report: Pick<ReportListItem, 'accountId' | 'region' | 'regions'>): string {
  const regions =
    report.regions && report.regions.length > 0
      ? report.regions
      : report.region
        ? [report.region]
        : [];
  return buildEc2AnalysisScopeKey({
    accountId: report.accountId ?? '',
    regions,
  });
}

export function compareEc2JobsNewestFirst(a: Ec2AsyncJob, b: Ec2AsyncJob): number {
  return b.createdAt.localeCompare(a.createdAt) || b.jobId.localeCompare(a.jobId);
}

export function pickLatestEc2AnalysisJobsByScope(jobs: Ec2AsyncJob[]): Ec2AsyncJob[] {
  const sorted = [...jobs].sort(compareEc2JobsNewestFirst);
  const latestByScope = new Map<string, Ec2AsyncJob>();
  for (const job of sorted) {
    const key = buildEc2AnalysisScopeKeyFromJob(job);
    if (!latestByScope.has(key)) {
      latestByScope.set(key, job);
    }
  }
  return [...latestByScope.values()].sort(compareEc2JobsNewestFirst);
}

export function compareReportsNewestFirst(a: ReportListItem, b: ReportListItem): number {
  return b.createdAt.localeCompare(a.createdAt) || b.reportId.localeCompare(a.reportId);
}

export function pickLatestEc2ReportsByScope(reports: ReportListItem[]): ReportListItem[] {
  const sorted = [...reports].sort(compareReportsNewestFirst);
  const latestByScope = new Map<string, ReportListItem>();
  for (const report of sorted) {
    const key = buildEc2ReportScopeKey(report);
    if (!latestByScope.has(key)) {
      latestByScope.set(key, report);
    }
  }
  return [...latestByScope.values()].sort(compareReportsNewestFirst);
}

export function isEc2AsyncJobScopeBlocking(job: Ec2AsyncJob): boolean {
  if (job.isScopeBlocking !== undefined) {
    return job.isScopeBlocking;
  }
  if (job.queueStatus === 'ENQUEUE_FAILED') {
    return false;
  }
  return !isTerminalJobStatus(job.status, job.stage);
}

export function findActiveEc2AnalysisJobForScope(
  jobs: Ec2AsyncJob[],
  scope: { accountId: string; regions?: string[] },
): Ec2AsyncJob | undefined {
  const targetKey = buildEc2AnalysisScopeKey(scope);
  return [...jobs]
    .sort(compareEc2JobsNewestFirst)
    .find(
      (job) =>
        buildEc2AnalysisScopeKeyFromJob(job) === targetKey &&
        isEc2AsyncJobScopeBlocking(job),
    );
}

export function formatLatestHistorySummary(options: {
  visibleLatestCount: number;
  totalCount: number;
  noun: 'analysis' | 'report';
}): string {
  const { visibleLatestCount, totalCount, noun } = options;
  const plural = visibleLatestCount === 1 ? '' : 's';
  const totalLabel = noun === 'analysis' ? 'runs' : 'reports';
  if (totalCount <= visibleLatestCount) {
    return `${totalCount} ${noun === 'analysis' ? 'analysis run' : 'live EC2 report'}${totalCount === 1 ? '' : 's'}.`;
  }
  return `${visibleLatestCount} latest ${noun}${plural} shown · ${totalCount} total ${totalLabel}`;
}
