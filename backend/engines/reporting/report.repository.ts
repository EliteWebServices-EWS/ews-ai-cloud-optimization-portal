/**
 * Persistence boundary for optimization reports.
 *
 * Implementations must enforce tenant scoping for every read, list, and
 * history operation. A DynamoDB implementation can be introduced without
 * changing reporting business logic.
 */

import type { OptimizationReport } from '../../shared/types';

/** Fields suitable for report list views and secondary indexes. */
export type ReportMetadata = Pick<
  OptimizationReport,
  | 'reportId'
  | 'tenantId'
  | 'workflowId'
  | 'plugin'
  | 'status'
  | 'workflowStatus'
  | 'createdAt'
  | 'completedAt'
  | 'region'
>;

/** An immutable audit trail entry for a report write or deletion. */
export interface ReportHistoryEntry {
  historyId: string;
  tenantId: string;
  reportId: string;
  workflowId: string;
  action: 'created' | 'updated' | 'deleted';
  recordedAt: string;
  metadata: ReportMetadata;
  /** A snapshot is present for create/update events and omitted for deletion. */
  report?: OptimizationReport;
}

/**
 * Repository contract for report persistence.
 *
 * All return values are tenant-scoped. Implementations must return undefined
 * rather than a report owned by a different tenant.
 */
export interface ReportRepository {
  save(report: OptimizationReport): Promise<OptimizationReport>;
  findById(
    tenantId: string,
    reportId: string
  ): Promise<OptimizationReport | undefined>;
  findByWorkflowId(
    tenantId: string,
    workflowId: string
  ): Promise<OptimizationReport | undefined>;
  listMetadata(tenantId: string): Promise<ReportMetadata[]>;
  list(tenantId: string): Promise<OptimizationReport[]>;
  getHistory(
    tenantId: string,
    reportId: string
  ): Promise<ReportHistoryEntry[]>;
  delete(tenantId: string, reportId: string): Promise<boolean>;
  /**
   * Ownership-index lookups used only for tenant.access_denied auditing.
   * They intentionally bypass tenant scoping; callers must never return
   * the resolved tenant to a client.
   */
  resolveOwnerTenantId(reportId: string): Promise<string | undefined>;
  resolveOwnerTenantIdByWorkflow(
    workflowId: string
  ): Promise<string | undefined>;
}

export function toReportMetadata(
  report: OptimizationReport
): ReportMetadata {
  return {
    reportId: report.reportId,
    tenantId: report.tenantId,
    workflowId: report.workflowId,
    plugin: report.plugin,
    status: report.status,
    workflowStatus: report.workflowStatus,
    createdAt: report.createdAt,
    completedAt: report.completedAt,
    region: report.region,
  };
}
