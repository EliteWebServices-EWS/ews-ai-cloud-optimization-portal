import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DynamoDbReportRepository,
  type ReportQuery,
} from '../../engines/reporting';
import {
  buildReportHistorySk,
} from '../../engines/reporting/dynamodb-report.repository';
import { compareAppendOnlySortKeys } from '../../persistence/append-only-key';
import type { OptimizationReport } from '../../shared/types';
import { PLUGIN_NAMES, WORKFLOW_STATES } from '../../shared/constants';
import { createLinkedFakePersistenceTables } from './support/fake-persistence-table';

function createReportRepository(now?: () => string) {
  const { reports, ownership } = createLinkedFakePersistenceTables();
  return new DynamoDbReportRepository(reports, ownership, now);
}

function buildReport(
  overrides: Partial<OptimizationReport> = {}
): OptimizationReport {
  return {
    reportId: 'rpt-001',
    tenantId: 'tenant-a',
    workflowId: 'workflow-001',
    plugin: PLUGIN_NAMES.EC2,
    status: 'complete',
    workflowStatus: WORKFLOW_STATES.COMPLETED,
    createdAt: '2026-07-21T12:00:00.000Z',
    region: 'us-east-1',
    summary: {
      headline: 'Opportunity found',
      opportunityCount: 1,
      estimatedMonthlySavings: 10,
      verifiedMonthlySavings: 0,
      verifiedCount: 0,
      currency: 'USD',
      optimizationStatus: 'complete',
      executiveSummary: 'Summary',
      technicalSummary: 'Technical summary',
    },
    resources: [],
    financialImpact: {
      currentMonthlyCost: 20,
      projectedMonthlyCost: 10,
      estimatedMonthlySavings: 10,
      estimatedAnnualSavings: 120,
      verifiedMonthlySavings: 0,
      percentageReduction: 50,
      currency: 'USD',
      status: 'ESTIMATED',
    },
    recommendations: [],
    exportOptions: [],
    ...overrides,
  };
}

function baseQuery(overrides: Partial<ReportQuery> = {}): ReportQuery {
  return {
    filters: {},
    sortBy: 'createdAt',
    sortOrder: 'desc',
    limit: 50,
    ...overrides,
  };
}

describe('DynamoDbReportRepository', () => {
  it('round-trips reports and looks them up by workflow ID', async () => {
    const repository = createReportRepository();

    await repository.save(buildReport());

    assert.equal(
      (await repository.findById('tenant-a', 'rpt-001'))?.reportId,
      'rpt-001'
    );
    assert.equal(
      (await repository.findByWorkflowId('tenant-a', 'workflow-001'))
        ?.reportId,
      'rpt-001'
    );
  });

  it('records append-only history across create and update', async () => {
    const fixedNow = '2026-07-27T20:14:54.302Z';
    let call = 0;
    const repository = createReportRepository(() => {
      call += 1;
      return fixedNow;
    });

    await repository.save(buildReport());
    await repository.save(buildReport({ status: 'partial' }));

    const history = await repository.getHistory('tenant-a', 'rpt-001');
    assert.deepEqual(
      history.map((entry) => entry.action),
      ['created', 'updated']
    );
    assert.equal(history.length, 2);
    assert.notEqual(history[0]?.historyId, history[1]?.historyId);
    assert.equal(call, 2);
  });

  it('orders create, update, and delete written in the same millisecond', async () => {
    const fixedNow = '2026-07-27T20:14:54.302Z';
    const repository = createReportRepository(() => fixedNow);

    await repository.save(buildReport());
    await repository.save(buildReport({ status: 'partial' }));
    await repository.delete('tenant-a', 'rpt-001');

    const history = await repository.getHistory('tenant-a', 'rpt-001');
    assert.deepEqual(
      history.map((entry) => entry.action),
      ['created', 'updated', 'deleted'],
    );
  });

  it('retains repeated updates recorded in the same millisecond', async () => {
    const fixedNow = '2026-07-27T20:14:54.302Z';
    const repository = createReportRepository(() => fixedNow);
    const report = buildReport();

    await repository.save(report);
    await repository.save({ ...report, status: 'partial' });
    await repository.save({ ...report, status: 'complete' });

    const history = await repository.getHistory('tenant-a', 'rpt-001');
    assert.deepEqual(
      history.map((entry) => entry.action),
      ['created', 'updated', 'updated'],
    );
    assert.equal(new Set(history.map((entry) => entry.historyId)).size, 3);
  });

  it('sorts same-timestamp lifecycle keys deterministically', () => {
    const reportId = 'rpt-sort';
    const recordedAt = '2026-07-27T20:14:54.302Z';
    const created = buildReportHistorySk(reportId, recordedAt, 'created');
    const updated = buildReportHistorySk(reportId, recordedAt, 'updated');

    assert.equal(compareAppendOnlySortKeys(created, updated), -1);
  });

  it('reads legacy numeric and timestamp#uuid history keys', async () => {
    const { reports, ownership } = createLinkedFakePersistenceTables();
    const repository = new DynamoDbReportRepository(reports, ownership);
    const report = buildReport();
    const pk = `TENANT#${report.tenantId}`;
    const prefix = `REPORTHIST#${report.reportId}#`;

    await reports.putItem({
      pk,
      sk: `${prefix}1`,
      entityType: 'report-history',
      data: {
        historyId: `${report.reportId}:1`,
        tenantId: report.tenantId,
        reportId: report.reportId,
        workflowId: report.workflowId,
        action: 'created',
        recordedAt: '2026-07-20T00:00:00.000Z',
        metadata: {},
      },
    });
    await reports.putItem({
      pk,
      sk: `${prefix}2026-07-21T12:00:00.000Z#aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
      entityType: 'report-history',
      data: {
        historyId: `${report.reportId}:2026-07-21T12:00:00.000Z#aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
        tenantId: report.tenantId,
        reportId: report.reportId,
        workflowId: report.workflowId,
        action: 'updated',
        recordedAt: '2026-07-21T12:00:00.000Z',
        metadata: {},
      },
    });

    const history = await repository.getHistory(report.tenantId, report.reportId);
    assert.deepEqual(history.map((entry) => entry.action), ['created', 'updated']);
  });

  it('deletes report content while retaining history and clearing ownership', async () => {
    const repository = createReportRepository();
    await repository.save(buildReport());

    assert.equal(await repository.delete('tenant-a', 'rpt-001'), true);
    assert.equal(await repository.findById('tenant-a', 'rpt-001'), undefined);
    assert.equal(
      await repository.resolveOwnerTenantId('rpt-001'),
      undefined
    );

    const history = await repository.getHistory('tenant-a', 'rpt-001');
    assert.equal(history.at(-1)?.action, 'deleted');
  });

  it('resolves owner tenant for denial auditing but isolates reads', async () => {
    const repository = createReportRepository();
    await repository.save(buildReport());

    assert.equal(
      await repository.resolveOwnerTenantId('rpt-001'),
      'tenant-a'
    );
    assert.equal(
      await repository.resolveOwnerTenantIdByWorkflow('workflow-001'),
      'tenant-a'
    );
    assert.equal(await repository.findById('tenant-b', 'rpt-001'), undefined);
    assert.deepEqual(await repository.list('tenant-b'), []);
  });

  it('applies search, filter, sort, and pagination via query()', async () => {
    const repository = createReportRepository();

    await repository.save(
      buildReport({
        reportId: 'rpt-a',
        workflowId: 'wf-a',
        createdAt: '2026-07-19T00:00:00.000Z',
        summary: {
          ...buildReport().summary,
          headline: 'Rightsize database tier',
          estimatedMonthlySavings: 40,
        },
      })
    );
    await repository.save(
      buildReport({
        reportId: 'rpt-b',
        workflowId: 'wf-b',
        createdAt: '2026-07-20T00:00:00.000Z',
        summary: {
          ...buildReport().summary,
          headline: 'Rightsize web tier',
          estimatedMonthlySavings: 25,
        },
      })
    );

    const page = await repository.query(
      'tenant-a',
      baseQuery({
        search: 'rightsize',
        sortBy: 'estimatedMonthlySavings',
        sortOrder: 'desc',
        limit: 25,
      })
    );

    assert.deepEqual(
      page.reports.map((r) => r.reportId),
      ['rpt-a', 'rpt-b']
    );
    assert.equal(page.total, 2);
    assert.equal(page.nextToken, undefined);
  });

  it('survives a fresh repository over the same table (restart)', async () => {
    const { reports, ownership } = createLinkedFakePersistenceTables();
    await new DynamoDbReportRepository(reports, ownership).save(
      buildReport()
    );

    const afterRestart = new DynamoDbReportRepository(reports, ownership);
    const listed = await afterRestart.list('tenant-a');
    assert.deepEqual(
      listed.map((r) => r.reportId),
      ['rpt-001']
    );
  });
});
