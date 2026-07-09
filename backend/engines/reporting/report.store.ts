/**
 * In-memory report store for Demo Mode report persistence.
 * Swappable for DynamoDB/S3 in future sprints.
 */

import type { OptimizationReport } from '../../shared/types';

/** Interface for report persistence. */
export interface ReportStoreInterface {
  save(report: OptimizationReport): void;
  get(reportId: string): OptimizationReport | undefined;
  getByWorkflowId(workflowId: string): OptimizationReport | undefined;
  list(): OptimizationReport[];
  delete(reportId: string): boolean;
}

/** In-memory optimization report registry. */
export class InMemoryReportStore implements ReportStoreInterface {
  private readonly reports = new Map<string, OptimizationReport>();
  private readonly workflowIndex = new Map<string, string>();

  save(report: OptimizationReport): void {
    this.reports.set(report.reportId, report);
    this.workflowIndex.set(report.workflowId, report.reportId);
  }

  get(reportId: string): OptimizationReport | undefined {
    return this.reports.get(reportId);
  }

  getByWorkflowId(workflowId: string): OptimizationReport | undefined {
    const reportId = this.workflowIndex.get(workflowId);
    if (!reportId) {
      return undefined;
    }
    return this.reports.get(reportId);
  }

  list(): OptimizationReport[] {
    return Array.from(this.reports.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  delete(reportId: string): boolean {
    const report = this.reports.get(reportId);
    if (!report) {
      return false;
    }
    this.reports.delete(reportId);
    this.workflowIndex.delete(report.workflowId);
    return true;
  }
}

export function createReportStore(): InMemoryReportStore {
  return new InMemoryReportStore();
}
