import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DynamoDbReportRepository } from '../../engines/reporting/dynamodb-report.repository';
import type { OptimizationReport } from '../../shared/types';
import { PLUGIN_NAMES, WORKFLOW_STATES } from '../../shared/constants';
import { createLinkedFakePersistenceTables } from './support/fake-persistence-table';

function buildReport(): OptimizationReport {
  return {
    reportId: 'rpt-concurrent',
    tenantId: 'tenant-a',
    workflowId: 'workflow-concurrent',
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
  };
}

describe('Concurrent history append', () => {
  it('preserves all entries without overwrite collisions', async () => {
    const { reports, ownership } = createLinkedFakePersistenceTables();
    const repository = new DynamoDbReportRepository(reports, ownership);
    const report = buildReport();

    await repository.save(report);

    const appendCount = 25;
    await Promise.all(
      Array.from({ length: appendCount }).map(() =>
        repository.save({ ...report, status: 'partial' })
      )
    );

    const history = await repository.getHistory('tenant-a', report.reportId);
    const updatedEntries = history.filter((entry) => entry.action === 'updated');

    assert.equal(updatedEntries.length, appendCount);
    assert.equal(
      new Set(updatedEntries.map((entry) => entry.historyId)).size,
      appendCount
    );
  });
});
