import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OptimizationReport } from '../../shared/types';
import { CONFIDENCE_STATUS, REPORT_SOURCE } from '../../shared/constants';
import { filterReports, parseReportFilters } from '../../engines/reporting/report.filter';

function buildEc2AsyncZeroReport(overrides: Partial<OptimizationReport> = {}): OptimizationReport {
  return {
    reportId: 'rpt-ec2-async-test',
    tenantId: 'tenant-1',
    workflowId: 'ec2-async:job-1',
    plugin: 'ec2',
    status: 'complete',
    workflowStatus: 'completed',
    createdAt: '2026-07-01T00:00:00.000Z',
    region: 'us-east-1',
    reportSource: REPORT_SOURCE.EC2_ASYNC,
    ec2AsyncJobId: 'job-1',
    summary: {
      headline: 'EC2 intelligence complete — no instances',
      opportunityCount: 0,
      estimatedMonthlySavings: 0,
      verifiedMonthlySavings: 0,
      verifiedCount: 0,
      currency: 'USD',
      optimizationStatus: 'complete',
      executiveSummary: 'Done',
      technicalSummary: 'Job complete.',
    },
    resources: [],
    financialImpact: {
      currentMonthlyCost: 0,
      projectedMonthlyCost: 0,
      estimatedMonthlySavings: 0,
      estimatedAnnualSavings: 0,
      verifiedMonthlySavings: 0,
      percentageReduction: 0,
      currency: 'USD',
      status: 'UNAVAILABLE',
    },
    recommendations: [],
    exportOptions: [],
    ...overrides,
  };
}

describe('filterReports', () => {
  it('includes zero-resource ec2_async reports when Resource Type is EC2', () => {
    const reports = [buildEc2AsyncZeroReport()];
    const filtered = filterReports(reports, { resourceType: 'EC2' });
    assert.equal(filtered.length, 1);
  });

  it('includes ec2_async reports when Status is complete', () => {
    const reports = [buildEc2AsyncZeroReport()];
    const filtered = filterReports(reports, { status: 'complete' });
    assert.equal(filtered.length, 1);
  });

  it('includes ec2_async reports when EC2 and complete are combined', () => {
    const reports = [buildEc2AsyncZeroReport()];
    const filtered = filterReports(reports, { resourceType: 'EC2', status: 'complete' });
    assert.equal(filtered.length, 1);
  });

  it('preserves NOT_APPLICABLE confidence semantics for zero-recommendation ec2_async', () => {
    const reports = [buildEc2AsyncZeroReport()];
    const filtered = filterReports(reports, { confidenceLevel: CONFIDENCE_STATUS.NOT_APPLICABLE });
    assert.equal(filtered.length, 1);

    const excluded = filterReports(reports, { confidenceLevel: 'HIGH' });
    assert.equal(excluded.length, 0);
  });

  it('does not exclude ec2_async reports when verification filter is unset', () => {
    const reports = [buildEc2AsyncZeroReport()];
    const filtered = filterReports(reports, {});
    assert.equal(filtered.length, 1);
  });

  it('filters demo and ec2_async independently', () => {
    const demoReport = buildEc2AsyncZeroReport({
      reportId: 'demo-1',
      reportSource: REPORT_SOURCE.DEMO,
      resources: [
        {
          resourceId: 'i-mock-001',
          resourceType: 'ec2',
          region: 'us-east-1',
        },
      ],
      recommendations: [
        {
          resourceId: 'i-mock-001',
          resourceType: 'ec2',
          region: 'us-east-1',
          decision: {
            recommendationStatus: 'RECOMMENDED',
            confidenceScore: 90,
            confidenceStatus: CONFIDENCE_STATUS.HIGH,
            governanceDecision: 'ALLOW',
            governanceReason: 'Demo',
            summary: 'Resize',
            reason: 'Demo',
            action: 'RESIZE',
          },
        },
      ],
    });
    const live = buildEc2AsyncZeroReport();
    const ec2Only = filterReports([demoReport, live], { resourceType: 'EC2' });
    assert.equal(ec2Only.length, 2);
  });

  it('filters by reportSource ec2_async and excludes demo, workflow, and missing source', () => {
    const live = buildEc2AsyncZeroReport();
    const demo = buildEc2AsyncZeroReport({
      reportId: 'demo-1',
      reportSource: REPORT_SOURCE.DEMO,
    });
    const workflow = buildEc2AsyncZeroReport({
      reportId: 'wf-1',
      reportSource: REPORT_SOURCE.WORKFLOW,
    });
    const legacy = buildEc2AsyncZeroReport({
      reportId: 'legacy-1',
      reportSource: undefined,
    });
    const mixed = [demo, workflow, legacy, live];
    const filtered = filterReports(mixed, { reportSource: REPORT_SOURCE.EC2_ASYNC });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.reportId, live.reportId);
  });

  it('parseReportFilters reads reportSource query parameter', () => {
    const criteria = parseReportFilters({ reportSource: 'ec2_async', status: 'complete' });
    assert.equal(criteria.reportSource, REPORT_SOURCE.EC2_ASYNC);
    assert.equal(criteria.status, 'complete');
  });

  it('includes zero-resource ec2_async when reportSource and status are combined', () => {
    const reports = [buildEc2AsyncZeroReport()];
    const filtered = filterReports(reports, {
      reportSource: REPORT_SOURCE.EC2_ASYNC,
      status: 'complete',
    });
    assert.equal(filtered.length, 1);
  });

  it('includes zero-resource ec2_async when reportSource and resourceType EC2 are combined', () => {
    const reports = [buildEc2AsyncZeroReport()];
    const filtered = filterReports(reports, {
      reportSource: REPORT_SOURCE.EC2_ASYNC,
      resourceType: 'EC2',
    });
    assert.equal(filtered.length, 1);
  });

  it('includes zero-resource ec2_async when reportSource, status, and EC2 are combined', () => {
    const reports = [buildEc2AsyncZeroReport()];
    const filtered = filterReports(reports, {
      reportSource: REPORT_SOURCE.EC2_ASYNC,
      status: 'complete',
      resourceType: 'EC2',
    });
    assert.equal(filtered.length, 1);
  });

  it('preserves NOT_APPLICABLE confidence with reportSource ec2_async filter', () => {
    const reports = [buildEc2AsyncZeroReport()];
    const filtered = filterReports(reports, {
      reportSource: REPORT_SOURCE.EC2_ASYNC,
      confidenceLevel: CONFIDENCE_STATUS.NOT_APPLICABLE,
    });
    assert.equal(filtered.length, 1);
  });
});
