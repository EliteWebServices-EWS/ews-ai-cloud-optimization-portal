/** In-memory ReportRepository implementation for development and unit tests. */

import type { OptimizationReport } from '../../shared/types';
import {
  toReportMetadata,
  type ReportHistoryEntry,
  type ReportMetadata,
  type ReportRepository,
} from './report.repository';
import {
  applyReportQuery,
  type ReportQuery,
  type ReportQueryResult,
} from './report.query';

function reportKey(tenantId: string, reportId: string): string {
  return `${tenantId}:${reportId}`;
}

function workflowKey(tenantId: string, workflowId: string): string {
  return `${tenantId}:${workflowId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Mock repository that models the tenant-boundary and immutable-history
 * behavior required of a durable repository.
 */
export class MockReportRepository implements ReportRepository {
  private readonly reports = new Map<string, OptimizationReport>();
  private readonly workflowIndex = new Map<string, string>();
  private readonly history = new Map<string, ReportHistoryEntry[]>();
  private readonly reportOwnerIndex = new Map<string, string>();
  private readonly workflowOwnerIndex = new Map<string, string>();

  async save(report: OptimizationReport): Promise<OptimizationReport> {
    const key = reportKey(report.tenantId, report.reportId);
    const existing = this.reports.get(key);
    const stored = clone(report);

    if (existing && existing.workflowId !== stored.workflowId) {
      this.workflowIndex.delete(
        workflowKey(existing.tenantId, existing.workflowId)
      );
    }

    this.reports.set(key, stored);
    this.workflowIndex.set(
      workflowKey(stored.tenantId, stored.workflowId),
      stored.reportId
    );
    this.reportOwnerIndex.set(stored.reportId, stored.tenantId);
    this.workflowOwnerIndex.set(stored.workflowId, stored.tenantId);
    this.appendHistory(stored, existing ? 'updated' : 'created');

    return clone(stored);
  }

  async findById(
    tenantId: string,
    reportId: string
  ): Promise<OptimizationReport | undefined> {
    const report = this.reports.get(reportKey(tenantId, reportId));
    return report ? clone(report) : undefined;
  }

  async findByWorkflowId(
    tenantId: string,
    workflowId: string
  ): Promise<OptimizationReport | undefined> {
    const reportId = this.workflowIndex.get(workflowKey(tenantId, workflowId));
    return reportId ? this.findById(tenantId, reportId) : undefined;
  }

  async listMetadata(tenantId: string): Promise<ReportMetadata[]> {
    const reports = await this.list(tenantId);
    return reports.map(toReportMetadata);
  }

  async list(tenantId: string): Promise<OptimizationReport[]> {
    return Array.from(this.reports.values())
      .filter((report) => report.tenantId === tenantId)
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime()
      )
      .map(clone);
  }

  async query(
    tenantId: string,
    query: ReportQuery
  ): Promise<ReportQueryResult> {
    return applyReportQuery(await this.list(tenantId), query);
  }

  async getHistory(
    tenantId: string,
    reportId: string
  ): Promise<ReportHistoryEntry[]> {
    const entries = this.history.get(reportKey(tenantId, reportId)) ?? [];
    return entries.map(clone);
  }

  async delete(tenantId: string, reportId: string): Promise<boolean> {
    const key = reportKey(tenantId, reportId);
    const report = this.reports.get(key);

    if (!report) {
      return false;
    }

    this.reports.delete(key);
    this.workflowIndex.delete(workflowKey(tenantId, report.workflowId));
    this.reportOwnerIndex.delete(reportId);
    this.workflowOwnerIndex.delete(report.workflowId);
    this.appendHistory(report, 'deleted');
    return true;
  }

  async resolveOwnerTenantId(
    reportId: string
  ): Promise<string | undefined> {
    return this.reportOwnerIndex.get(reportId);
  }

  async resolveOwnerTenantIdByWorkflow(
    workflowId: string
  ): Promise<string | undefined> {
    return this.workflowOwnerIndex.get(workflowId);
  }

  private appendHistory(
    report: OptimizationReport,
    action: ReportHistoryEntry['action']
  ): void {
    const key = reportKey(report.tenantId, report.reportId);
    const entries = this.history.get(key) ?? [];
    const entry: ReportHistoryEntry = {
      historyId: `${report.reportId}:${entries.length + 1}`,
      tenantId: report.tenantId,
      reportId: report.reportId,
      workflowId: report.workflowId,
      action,
      recordedAt: new Date().toISOString(),
      metadata: toReportMetadata(report),
      ...(action === 'deleted' ? {} : { report: clone(report) }),
    };

    entries.push(entry);
    this.history.set(key, entries);
  }
}
