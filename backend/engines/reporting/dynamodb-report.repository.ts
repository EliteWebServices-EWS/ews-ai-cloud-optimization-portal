/**
 * DynamoDB-backed ReportRepository.
 *
 * Report content and history live in the dedicated Reports table (tenant
 * partition unless noted):
 *   REPORT#<reportId>            report content
 *   REPORTWF#<workflowId>        workflow -> reportId pointer
 *   REPORTHIST#<reportId>#<seq|timestamp#uuid>  append-only history
 *
 * Cross-tenant ownership lookups use the shared Ownership table.
 */

import type { OptimizationReport } from '../../shared/types';
import { OwnershipConflictError } from '../../database';
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
  buildAppendOnlyKeySuffix,
  compareAppendOnlySortKeys,
} from '../../persistence/append-only-key';
import {
  buildSameOwnerConditionValues,
  resolveEngineOwnershipTenantId,
  SAME_OWNER_CONDITION,
} from '../../persistence/engine-ownership';
import { computeExpiresAt, REPORT_RETENTION_SECONDS } from '../../persistence/retention';
import { executeTransactWrite } from '../../persistence/transact-write';
import {
  toReportMetadata,
  type ReportHistoryEntry,
  type ReportMetadata,
  type ReportRepository,
} from './report.repository';
import {
  searchReports,
  sortReports,
  type ReportQuery,
  type ReportQueryResult,
} from './report.query';
import { filterReports } from './report.filter';

function reportSk(reportId: string): string {
  return `REPORT#${reportId}`;
}

function workflowPointerSk(workflowId: string): string {
  return `REPORTWF#${workflowId}`;
}

function historyPrefix(reportId: string): string {
  return `REPORTHIST#${reportId}#`;
}

function buildHistorySk(reportId: string, recordedAt: string): string {
  return `${historyPrefix(reportId)}${buildAppendOnlyKeySuffix(recordedAt)}`;
}

function legacyHistorySeq(sk: string, prefix: string): number | undefined {
  if (!sk.startsWith(prefix)) {
    return undefined;
  }

  const suffix = sk.slice(prefix.length);
  if (/^\d+$/.test(suffix)) {
    return Number(suffix);
  }

  return undefined;
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

    const expiresAt = computeExpiresAt(REPORT_RETENTION_SECONDS);
    const reportItem: PersistedItem = {
      pk,
      sk: reportSk(report.reportId),
      entityType: 'report',
      createdAt: report.createdAt,
      expiresAt,
      data: report,
    };
    const pointerItem: PersistedItem = {
      pk,
      sk: workflowPointerSk(report.workflowId),
      entityType: 'report-workflow-index',
      reportId: report.reportId,
      expiresAt,
    };

    const ownerValues = buildSameOwnerConditionValues(report.tenantId);
    const reportOwnerItem: PersistedItem = {
      pk: ownershipPartitionKey('REPORT', report.reportId),
      sk: OWNERSHIP_SORT_KEY,
      entityType: 'report-owner-index',
      ownerTenantId: report.tenantId,
      expiresAt,
    };
    const workflowOwnerItem: PersistedItem = {
      pk: ownershipPartitionKey('WORKFLOW', report.workflowId),
      sk: OWNERSHIP_SORT_KEY,
      entityType: 'workflow-owner-index',
      ownerTenantId: report.tenantId,
      expiresAt,
    };

    try {
      await executeTransactWrite(this.table.documentClient, [
        { tableName: this.table.name, item: reportItem },
        { tableName: this.table.name, item: pointerItem },
        {
          tableName: this.ownershipTable.name,
          item: reportOwnerItem,
          conditionExpression: SAME_OWNER_CONDITION,
          expressionAttributeValues: ownerValues,
        },
        {
          tableName: this.ownershipTable.name,
          item: workflowOwnerItem,
          conditionExpression: SAME_OWNER_CONDITION,
          expressionAttributeValues: ownerValues,
        },
      ]);
    } catch (error) {
      if (error instanceof OwnershipConflictError) {
        throw error;
      }

      throw error;
    }

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

  async listPage(
    tenantId: string,
    options: { limit?: number; nextToken?: string } = {}
  ): Promise<{ reports: OptimizationReport[]; nextToken?: string }> {
    const page = await this.table.queryPageByPrefix({
      pk: buildTenantPartitionKey(tenantId),
      skPrefix: 'REPORT#',
      limit: options.limit,
      nextToken: options.nextToken,
      scanIndexForward: false,
      paginationContext: {
        tenantId,
        scope: 'reports:list',
      },
    });

    const reports = page.items
      .map((item) => item.data as OptimizationReport)
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime()
      );

    return { reports, nextToken: page.nextToken };
  }

  async list(tenantId: string): Promise<OptimizationReport[]> {
    const page = await this.listPage(tenantId, { limit: 100 });
    return page.reports;
  }

  async listMetadata(tenantId: string): Promise<ReportMetadata[]> {
    return (await this.list(tenantId)).map(toReportMetadata);
  }

  async query(
    tenantId: string,
    query: ReportQuery
  ): Promise<ReportQueryResult> {
    const page = await this.listPage(tenantId, {
      limit: query.limit,
      nextToken: query.nextToken,
    });

    const searched = query.search
      ? searchReports(page.reports, query.search)
      : page.reports;
    const filtered = filterReports(searched, query.filters);
    const sorted = sortReports(filtered, query.sortBy, query.sortOrder);

    return {
      reports: sorted.slice(0, query.limit),
      total: sorted.length,
      nextToken: page.nextToken,
    };
  }

  async getHistory(
    tenantId: string,
    reportId: string
  ): Promise<ReportHistoryEntry[]> {
    const prefix = historyPrefix(reportId);
    const items = await this.table.queryByPrefix(
      buildTenantPartitionKey(tenantId),
      prefix
    );

    return items
      .sort((left, right) =>
        compareAppendOnlySortKeys(left.sk as string, right.sk as string)
      )
      .map((item) => {
        const entry = item.data as ReportHistoryEntry;
        const legacySeq = legacyHistorySeq(item.sk as string, prefix);
        if (legacySeq !== undefined && entry.historyId.endsWith(`:${legacySeq}`)) {
          return entry;
        }

        return entry;
      });
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
    return resolveEngineOwnershipTenantId(item);
  }

  async resolveOwnerTenantIdByWorkflow(
    workflowId: string
  ): Promise<string | undefined> {
    const item = await this.ownershipTable.getItem(
      ownershipPartitionKey('WORKFLOW', workflowId),
      OWNERSHIP_SORT_KEY
    );
    return resolveEngineOwnershipTenantId(item);
  }

  private async appendHistory(
    report: OptimizationReport,
    action: ReportHistoryEntry['action']
  ): Promise<void> {
    const pk = buildTenantPartitionKey(report.tenantId);
    const recordedAt = new Date().toISOString();
    const sk = buildHistorySk(report.reportId, recordedAt);

    const entry: ReportHistoryEntry = {
      historyId: `${report.reportId}:${sk.slice(historyPrefix(report.reportId).length)}`,
      tenantId: report.tenantId,
      reportId: report.reportId,
      workflowId: report.workflowId,
      action,
      recordedAt,
      metadata: toReportMetadata(report),
      ...(action === 'deleted' ? {} : { report }),
    };

    await this.table.putItem({
      pk,
      sk,
      entityType: 'report-history',
      expiresAt: computeExpiresAt(REPORT_RETENTION_SECONDS),
      data: entry,
    });
  }
}
