import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DynamoDbReportRepository,
  type ReportQuery,
} from '../../engines/reporting';
import type { OptimizationReport } from '../../shared/types';
import { PLUGIN_NAMES, WORKFLOW_STATES } from '../../shared/constants';
import { createFakePersistenceTable } from './support/fake-persistence-table';

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
    const repository = new DynamoDbReportRepository(
      createFakePersistenceTable(),
      createFakePersistenceTable()
    );

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
    const repository = new DynamoDbReportRepository(
      createFakePersistenceTable(),
      createFakePersistenceTable()
    );

    await repository.save(buildReport());
    await repository.save(buildReport({ status: 'partial' }));

    const history = await repository.getHistory('tenant-a', 'rpt-001');
    assert.deepEqual(
      history.map((entry) => entry.action),
      ['created', 'updated']
    );
    assert.deepEqual(
      history.map((entry) => entry.historyId),
      ['rpt-001:1', 'rpt-001:2']
    );
  });

  it('deletes report content while retaining history and clearing ownership', async () => {
    const repository = new DynamoDbReportRepository(
      createFakePersistenceTable(),
      createFakePersistenceTable()
    );
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
    const repository = new DynamoDbReportRepository(
      createFakePersistenceTable(),
      createFakePersistenceTable()
    );
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
    const repository = new DynamoDbReportRepository(
      createFakePersistenceTable(),
      createFakePersistenceTable()
    );

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
        limit: 1,
      })
    );

    assert.deepEqual(
      page.reports.map((r) => r.reportId),
      ['rpt-a']
    );
    assert.equal(page.total, 2);
    assert.ok(page.nextToken);
  });

  it('survives a fresh repository over the same table (restart)', async () => {
    const table = createFakePersistenceTable();
    const ownershipTable = createFakePersistenceTable();
    await new DynamoDbReportRepository(table, ownershipTable).save(
      buildReport()
    );

    const afterRestart = new DynamoDbReportRepository(table, ownershipTable);
    const reports = await afterRestart.list('tenant-a');
    assert.deepEqual(
      reports.map((r) => r.reportId),
      ['rpt-001']
    );
  });
});
