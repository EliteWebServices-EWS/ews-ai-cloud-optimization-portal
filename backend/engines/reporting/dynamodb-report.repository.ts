/**
 * DynamoDB-backed ReportRepository.
 *
 * Report content and history live in the dedicated Reports table (tenant
 * partition unless noted):
 *   REPORT#<reportId>            report content
 *   REPORTWF#<workflowId>        workflow -> reportId pointer
 *   REPORTHIST#<reportId>#<seq>  append-only history entries
 *
 * Cross-tenant ownership lookups (used only for tenant.access_denied
 * auditing) live in the shared Ownership table, keyed by the same
 * resourceType/resourceId scheme main's repository contracts use so any
 * future consumer of that table stays compatible:
 *   RESOURCE#REPORT#<reportId>    -> ownerTenantId
 *   RESOURCE#WORKFLOW#<workflowId> -> ownerTenantId
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
  ownershipPartitionKey,
  OWNERSHIP_SORT_KEY,
} from '../../database/dynamodb-keys';
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

export class DynamoDbReportRepository implements ReportRepository {
  constructor(
    private readonly table: PersistenceTable,
    private readonly ownershipTable: PersistenceTable
  ) {}

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
    ];

    await this.table.putItems(items);

    await this.ownershipTable.putItems([
      {
        pk: ownershipPartitionKey('REPORT', report.reportId),
        sk: OWNERSHIP_SORT_KEY,
        entityType: 'report-owner-index',
        tenantId: report.tenantId,
      },
      {
        pk: ownershipPartitionKey('WORKFLOW', report.workflowId),
        sk: OWNERSHIP_SORT_KEY,
        entityType: 'workflow-owner-index',
        tenantId: report.tenantId,
      },
    ]);

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
    await this.ownershipTable.deleteItem(
      ownershipPartitionKey('REPORT', reportId),
      OWNERSHIP_SORT_KEY
    );
    await this.ownershipTable.deleteItem(
      ownershipPartitionKey('WORKFLOW', report.workflowId),
      OWNERSHIP_SORT_KEY
    );
    await this.appendHistory(report, 'deleted');

    return true;
  }

  async resolveOwnerTenantId(
    reportId: string
  ): Promise<string | undefined> {
    const item = await this.ownershipTable.getItem(
      ownershipPartitionKey('REPORT', reportId),
      OWNERSHIP_SORT_KEY
    );
    return item?.tenantId as string | undefined;
  }

  async resolveOwnerTenantIdByWorkflow(
    workflowId: string
  ): Promise<string | undefined> {
    const item = await this.ownershipTable.getItem(
      ownershipPartitionKey('WORKFLOW', workflowId),
      OWNERSHIP_SORT_KEY
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
