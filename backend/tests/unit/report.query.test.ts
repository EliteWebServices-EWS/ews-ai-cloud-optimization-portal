import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REPORT_QUERY_LIMIT,
  MockReportRepository,
  ReportQueryValidationError,
  paginateReports,
  parseReportQuery,
  searchReports,
  sortReports,
  type ReportQuery,
} from '../../engines/reporting';
import type { OptimizationReport } from '../../shared/types';
import { PLUGIN_NAMES, WORKFLOW_STATES } from '../../shared/constants';

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
    limit: DEFAULT_REPORT_QUERY_LIMIT,
    ...overrides,
  };
}

describe('parseReportQuery', () => {
  it('applies defaults for an empty query string', () => {
    const query = parseReportQuery({});

    assert.deepEqual(query.filters, {});
    assert.equal(query.search, undefined);
    assert.equal(query.sortBy, 'createdAt');
    assert.equal(query.sortOrder, 'desc');
    assert.equal(query.limit, DEFAULT_REPORT_QUERY_LIMIT);
    assert.equal(query.nextToken, undefined);
  });

  it('parses search, sort, and pagination parameters', () => {
    const query = parseReportQuery({
      search: '  i-abc123 ',
      sortBy: 'estimatedMonthlySavings',
      sortOrder: 'DESC',
      limit: '5',
      nextToken: 'token-1',
      status: 'complete',
    });

    assert.equal(query.search, 'i-abc123');
    assert.equal(query.sortBy, 'estimatedMonthlySavings');
    assert.equal(query.sortOrder, 'desc');
    assert.equal(query.limit, 5);
    assert.equal(query.nextToken, 'token-1');
    assert.equal(query.filters.status, 'complete');
  });

  it('rejects unknown sort fields', () => {
    assert.throws(
      () => parseReportQuery({ sortBy: 'tenantId' }),
      ReportQueryValidationError
    );
  });

  it('rejects invalid sort order and limits', () => {
    assert.throws(
      () => parseReportQuery({ sortOrder: 'sideways' }),
      ReportQueryValidationError
    );
    assert.throws(
      () => parseReportQuery({ limit: '0' }),
      ReportQueryValidationError
    );
    assert.throws(
      () => parseReportQuery({ limit: '101' }),
      ReportQueryValidationError
    );
    assert.throws(
      () => parseReportQuery({ limit: 'ten' }),
      ReportQueryValidationError
    );
  });
});

describe('searchReports', () => {
  const reports = [
    buildReport({
      reportId: 'rpt-001',
      summary: {
        ...buildReport().summary,
        headline: 'Downsize m5.xlarge fleet',
      },
    }),
    buildReport({
      reportId: 'rpt-002',
      workflowId: 'workflow-002',
      resources: [
        {
          resourceId: 'i-0abc123def',
          resourceType: 'EC2',
          region: 'us-east-1',
        },
      ],
    }),
  ];

  it('matches case-insensitively across headline and resource IDs', () => {
    assert.deepEqual(
      searchReports(reports, 'M5.XLARGE').map((r) => r.reportId),
      ['rpt-001']
    );
    assert.deepEqual(
      searchReports(reports, 'i-0abc').map((r) => r.reportId),
      ['rpt-002']
    );
  });

  it('returns no results for unmatched terms', () => {
    assert.deepEqual(searchReports(reports, 'postgres'), []);
  });
});

describe('sortReports', () => {
  const reports = [
    buildReport({
      reportId: 'rpt-old',
      createdAt: '2026-07-19T00:00:00.000Z',
      summary: { ...buildReport().summary, estimatedMonthlySavings: 30 },
    }),
    buildReport({
      reportId: 'rpt-new',
      createdAt: '2026-07-21T00:00:00.000Z',
      summary: { ...buildReport().summary, estimatedMonthlySavings: 10 },
    }),
    buildReport({
      reportId: 'rpt-mid',
      createdAt: '2026-07-20T00:00:00.000Z',
      summary: { ...buildReport().summary, estimatedMonthlySavings: 20 },
    }),
  ];

  it('sorts by createdAt descending', () => {
    assert.deepEqual(
      sortReports(reports, 'createdAt', 'desc').map((r) => r.reportId),
      ['rpt-new', 'rpt-mid', 'rpt-old']
    );
  });

  it('sorts by estimated monthly savings ascending', () => {
    assert.deepEqual(
      sortReports(reports, 'estimatedMonthlySavings', 'asc').map(
        (r) => r.reportId
      ),
      ['rpt-new', 'rpt-mid', 'rpt-old']
    );
  });
});

describe('paginateReports', () => {
  const reports = [
    buildReport({ reportId: 'rpt-1' }),
    buildReport({ reportId: 'rpt-2' }),
    buildReport({ reportId: 'rpt-3' }),
  ];

  it('walks pages via continuation tokens until exhausted', () => {
    const first = paginateReports(reports, 2);
    assert.deepEqual(
      first.reports.map((r) => r.reportId),
      ['rpt-1', 'rpt-2']
    );
    assert.equal(first.total, 3);
    assert.ok(first.nextToken);

    const second = paginateReports(reports, 2, first.nextToken);
    assert.deepEqual(
      second.reports.map((r) => r.reportId),
      ['rpt-3']
    );
    assert.equal(second.nextToken, undefined);
  });

  it('treats malformed tokens as the first page', () => {
    const result = paginateReports(reports, 2, 'not-a-real-token');
    assert.deepEqual(
      result.reports.map((r) => r.reportId),
      ['rpt-1', 'rpt-2']
    );
  });
});

describe('applyReportQuery via MockReportRepository', () => {
  it('combines search, filters, sorting, and pagination', async () => {
    const repository = new MockReportRepository();

    await repository.save(
      buildReport({
        reportId: 'rpt-a',
        workflowId: 'wf-a',
        status: 'complete',
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
        status: 'complete',
        createdAt: '2026-07-20T00:00:00.000Z',
        summary: {
          ...buildReport().summary,
          headline: 'Rightsize web tier',
          estimatedMonthlySavings: 25,
        },
      })
    );
    await repository.save(
      buildReport({
        reportId: 'rpt-c',
        workflowId: 'wf-c',
        status: 'partial',
        createdAt: '2026-07-21T00:00:00.000Z',
        summary: {
          ...buildReport().summary,
          headline: 'Rightsize cache tier',
          estimatedMonthlySavings: 5,
        },
      })
    );

    const result = await repository.query(
      'tenant-a',
      baseQuery({
        search: 'rightsize',
        filters: { status: 'complete' },
        sortBy: 'estimatedMonthlySavings',
        sortOrder: 'desc',
        limit: 1,
      })
    );

    assert.deepEqual(
      result.reports.map((r) => r.reportId),
      ['rpt-a']
    );
    assert.equal(result.total, 2);
    assert.ok(result.nextToken);

    const nextPage = await repository.query(
      'tenant-a',
      baseQuery({
        search: 'rightsize',
        filters: { status: 'complete' },
        sortBy: 'estimatedMonthlySavings',
        sortOrder: 'desc',
        limit: 1,
        nextToken: result.nextToken,
      })
    );

    assert.deepEqual(
      nextPage.reports.map((r) => r.reportId),
      ['rpt-b']
    );
    assert.equal(nextPage.nextToken, undefined);
  });

  it('never returns another tenant\'s reports', async () => {
    const repository = new MockReportRepository();

    await repository.save(buildReport({ tenantId: 'tenant-a' }));
    await repository.save(
      buildReport({
        tenantId: 'tenant-b',
        reportId: 'rpt-b',
        workflowId: 'wf-b',
      })
    );

    const result = await repository.query('tenant-a', baseQuery());

    assert.equal(result.total, 1);
    assert.deepEqual(
      result.reports.map((r) => r.tenantId),
      ['tenant-a']
    );
  });
});
