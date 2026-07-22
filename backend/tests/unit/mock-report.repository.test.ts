import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockReportRepository } from '../../engines/reporting';
import type { OptimizationReport } from '../../shared/types';
import {
  PLUGIN_NAMES,
  WORKFLOW_STATES,
} from '../../shared/constants';

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

describe('MockReportRepository', () => {
  it('persists report metadata and immutable history snapshots', async () => {
    const repository = new MockReportRepository();
    const report = buildReport();

    await repository.save(report);
    report.summary.headline = 'Mutated outside the repository';
    await repository.save(buildReport({ status: 'partial' }));

    const metadata = await repository.listMetadata('tenant-a');
    const history = await repository.getHistory('tenant-a', 'rpt-001');

    assert.equal(metadata.length, 1);
    assert.equal(metadata[0].status, 'partial');
    assert.equal(history.length, 2);
    assert.equal(history[0].action, 'created');
    assert.equal(history[0].report?.summary.headline, 'Opportunity found');
    assert.equal(history[1].action, 'updated');
  });

  it('does not expose reports, workflow lookups, or history across tenants', async () => {
    const repository = new MockReportRepository();
    await repository.save(buildReport());

    assert.equal(await repository.findById('tenant-b', 'rpt-001'), undefined);
    assert.equal(
      await repository.findByWorkflowId('tenant-b', 'workflow-001'),
      undefined
    );
    assert.deepEqual(await repository.list('tenant-b'), []);
    assert.deepEqual(await repository.getHistory('tenant-b', 'rpt-001'), []);
  });

  it('records a deletion while retaining tenant-scoped history', async () => {
    const repository = new MockReportRepository();
    await repository.save(buildReport());

    assert.equal(await repository.delete('tenant-a', 'rpt-001'), true);
    assert.equal(await repository.findById('tenant-a', 'rpt-001'), undefined);

    const history = await repository.getHistory('tenant-a', 'rpt-001');
    assert.equal(history.at(-1)?.action, 'deleted');
    assert.equal(history.at(-1)?.report, undefined);
  });
});
