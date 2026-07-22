/**
 * DynamoDB-backed ReportRepository.
 *
 * Single-table layout (all under the tenant partition unless noted):
 *   REPORT#<reportId>            report content
 *   REPORTWF#<workflowId>        workflow -> reportId pointer
 *   REPORTHIST#<reportId>#<seq>  append-only history entries
 *   OWNER#REPORT#<reportId>      global reportId -> tenantId (audit only)
 *   OWNER#REPORTWF#<workflowId>  global workflowId -> tenantId (audit only)
 *
 * Search, filter, sort, and pagination reuse the shared pure query functions
 * so behavior matches the mock exactly. A GSI-backed push-down is a future
 * optimization; per-tenant report volumes are small enough to query fully.
 */

import type { OptimizationReport } from '../../shared/types';
import {
  buildTenantPartitionKey,
  type PersistedItem,
  type PersistenceTable,
} from '../../persistence/persistence-table';
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

const OWNER_SK = 'OWNER';

function reportSk(reportId: string): string {
  return `REPORT#${reportId}`;
}

function workflowPointerSk(workflowId: string): string {
  return `REPORTWF#${workflowId}`;
}

function historyPrefix(reportId: string): string {
  return `REPORTHIST#${reportId}#`;
}

function historySk(reportId: string, seq: number): string {
  return `${historyPrefix(reportId)}${String(seq).padStart(12, '0')}`;
}

function reportOwnerPk(reportId: string): string {
  return `OWNER#REPORT#${reportId}`;
}

function workflowOwnerPk(workflowId: string): string {
  return `OWNER#REPORTWF#${workflowId}`;
}

export class DynamoDbReportRepository implements ReportRepository {
  constructor(private readonly table: PersistenceTable) {}

  async save(report: OptimizationReport): Promise<OptimizationReport> {
    const pk = buildTenantPartitionKey(report.tenantId);
    const existingItem = await this.table.getItem(pk, reportSk(report.reportId));
    const existing = existingItem?.data as OptimizationReport | undefined;

    if (existing && existing.workflowId !== report.workflowId) {
      await this.table.deleteItem(pk, workflowPointerSk(existing.workflowId));
    }

    const items: PersistedItem[] = [
      {
        pk,
        sk: reportSk(report.reportId),
        entityType: 'report',
        createdAt: report.createdAt,
        data: report,
      },
      {
        pk,
        sk: workflowPointerSk(report.workflowId),
        entityType: 'report-workflow-index',
        reportId: report.reportId,
      },
      {
        pk: reportOwnerPk(report.reportId),
        sk: OWNER_SK,
        entityType: 'report-owner-index',
        tenantId: report.tenantId,
      },
      {
        pk: workflowOwnerPk(report.workflowId),
        sk: OWNER_SK,
        entityType: 'report-workflow-owner-index',
        tenantId: report.tenantId,
      },
    ];

    await this.table.putItems(items);
    await this.appendHistory(report, existing ? 'updated' : 'created');

    return report;
  }

  async findById(
    tenantId: string,
    reportId: string
  ): Promise<OptimizationReport | undefined> {
    const item = await this.table.getItem(
      buildTenantPartitionKey(tenantId),
      reportSk(reportId)
    );

    return item?.data as OptimizationReport | undefined;
  }

  async findByWorkflowId(
    tenantId: string,
    workflowId: string
  ): Promise<OptimizationReport | undefined> {
    const pointer = await this.table.getItem(
      buildTenantPartitionKey(tenantId),
      workflowPointerSk(workflowId)
    );

    const reportId = pointer?.reportId as string | undefined;
    return reportId ? this.findById(tenantId, reportId) : undefined;
  }

  async list(tenantId: string): Promise<OptimizationReport[]> {
    const items = await this.table.queryByPrefix(
      buildTenantPartitionKey(tenantId),
      'REPORT#'
    );

    return items
      .map((item) => item.data as OptimizationReport)
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime()
      );
  }

  async listMetadata(tenantId: string): Promise<ReportMetadata[]> {
    return (await this.list(tenantId)).map(toReportMetadata);
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
    const items = await this.table.queryByPrefix(
      buildTenantPartitionKey(tenantId),
      historyPrefix(reportId)
    );

    return items.map((item) => item.data as ReportHistoryEntry);
  }

  async delete(tenantId: string, reportId: string): Promise<boolean> {
    const pk = buildTenantPartitionKey(tenantId);
    const item = await this.table.getItem(pk, reportSk(reportId));
    const report = item?.data as OptimizationReport | undefined;

    if (!report) {
      return false;
    }

    await this.table.deleteItem(pk, reportSk(reportId));
    await this.table.deleteItem(pk, workflowPointerSk(report.workflowId));
    await this.table.deleteItem(reportOwnerPk(reportId), OWNER_SK);
    await this.table.deleteItem(workflowOwnerPk(report.workflowId), OWNER_SK);
    await this.appendHistory(report, 'deleted');

    return true;
  }

  async resolveOwnerTenantId(
    reportId: string
  ): Promise<string | undefined> {
    const item = await this.table.getItem(reportOwnerPk(reportId), OWNER_SK);
    return item?.tenantId as string | undefined;
  }

  async resolveOwnerTenantIdByWorkflow(
    workflowId: string
  ): Promise<string | undefined> {
    const item = await this.table.getItem(
      workflowOwnerPk(workflowId),
      OWNER_SK
    );
    return item?.tenantId as string | undefined;
  }

  private async appendHistory(
    report: OptimizationReport,
    action: ReportHistoryEntry['action']
  ): Promise<void> {
    const pk = buildTenantPartitionKey(report.tenantId);
    const existing = await this.table.queryByPrefix(
      pk,
      historyPrefix(report.reportId)
    );
    const seq = existing.length + 1;

    const entry: ReportHistoryEntry = {
      historyId: `${report.reportId}:${seq}`,
      tenantId: report.tenantId,
      reportId: report.reportId,
      workflowId: report.workflowId,
      action,
      recordedAt: new Date().toISOString(),
      metadata: toReportMetadata(report),
      ...(action === 'deleted' ? {} : { report }),
    };

    await this.table.putItem({
      pk,
      sk: historySk(report.reportId, seq),
      entityType: 'report-history',
      data: entry,
    });
  }
}
