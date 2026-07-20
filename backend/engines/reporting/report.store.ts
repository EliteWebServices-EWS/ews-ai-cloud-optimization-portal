/**
 * In-memory report store for Demo Mode report persistence.
 * Swappable for DynamoDB/S3 in future sprints.
 * Sprint 10.5.16: tenant-scoped lookups prevent cross-tenant access.
 */

import { recordBelongsToTenant } from '../../auth/tenant';
import type { OptimizationReport } from '../../shared/types';

function buildStoreKey(tenantId: string, reportId: string): string {
  return `${tenantId}:${reportId}`;
}

function buildWorkflowIndexKey(tenantId: string, workflowId: string): string {
  return `${tenantId}:${workflowId}`;
}

/** Interface for report persistence. */
export interface ReportStoreInterface {
  save(report: OptimizationReport): void;
  get(tenantId: string, reportId: string): OptimizationReport | undefined;
  getByWorkflowId(tenantId: string, workflowId: string): OptimizationReport | undefined;
  list(tenantId: string): OptimizationReport[];
  delete(tenantId: string, reportId: string): boolean;
}

/** In-memory optimization report registry. */
export class InMemoryReportStore implements ReportStoreInterface {
  private readonly reports = new Map<string, OptimizationReport>();
  private readonly workflowIndex = new Map<string, string>();

  save(report: OptimizationReport): void {
    const key = buildStoreKey(report.tenantId, report.reportId);
    this.reports.set(key, report);
    this.workflowIndex.set(
      buildWorkflowIndexKey(report.tenantId, report.workflowId),
      report.reportId
    );
  }

  get(tenantId: string, reportId: string): OptimizationReport | undefined {
    const report = this.reports.get(buildStoreKey(tenantId, reportId));

    if (!report) {
      return undefined;
    }

    if (!recordBelongsToTenant(report.tenantId, tenantId)) {
      return undefined;
    }

    return report;
  }

  getByWorkflowId(tenantId: string, workflowId: string): OptimizationReport | undefined {
    const reportId = this.workflowIndex.get(
      buildWorkflowIndexKey(tenantId, workflowId)
    );

    if (!reportId) {
      return undefined;
    }

    return this.get(tenantId, reportId);
  }

  list(tenantId: string): OptimizationReport[] {
    return Array.from(this.reports.values())
      .filter((report) => recordBelongsToTenant(report.tenantId, tenantId))
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }

  delete(tenantId: string, reportId: string): boolean {
    const report = this.get(tenantId, reportId);

    if (!report) {
      return false;
    }

    this.reports.delete(buildStoreKey(tenantId, reportId));
    this.workflowIndex.delete(
      buildWorkflowIndexKey(tenantId, report.workflowId)
    );

    return true;
  }
}

export function createReportStore(): InMemoryReportStore {
  return new InMemoryReportStore();
}
