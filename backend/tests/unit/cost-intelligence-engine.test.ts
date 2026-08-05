import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COST_FINDING_TYPES } from '../../shared/constants';
import type { Ec2CostCollectionResult, ProviderPricing } from '../../shared/types';
import { analyzeEc2Costs } from '../../engines/cost-intelligence/cost-intelligence.engine';
import type { Ec2CostDataSource } from '../../engines/cost-intelligence/data-source';
import { lookupReferencePricing } from '../../engines/cost-intelligence/pricing/ec2-reference-pricing';

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

class StaticEc2CostDataSource implements Ec2CostDataSource {
  constructor(private readonly collection: Ec2CostCollectionResult) {}

  async collect(): Promise<Ec2CostCollectionResult> {
    return this.collection;
  }

  async getPricing(instanceType: string, region: string): Promise<ProviderPricing> {
    return lookupReferencePricing(instanceType, region);
  }
}

describe('analyzeEc2Costs', () => {
  it('produces a previous-generation finding with real projected savings', async () => {
    const collection: Ec2CostCollectionResult = {
      accountId: '111111111111',
      region: 'us-east-1',
      collectedAt: new Date().toISOString(),
      costDataDegraded: false,
      instances: [
        {
          instanceId: 'i-abc123',
          instanceType: 'm4.large',
          state: 'running',
          region: 'us-east-1',
          launchTime: daysAgo(200),
          tags: { Environment: 'production', Owner: 'platform-team' },
          observedMonthlyCost: 73,
        },
      ],
    };

    const report = await analyzeEc2Costs({
      analysisId: 'costan-test-1',
      tenantId: 'tenant-a',
      collection,
      dataSource: new StaticEc2CostDataSource(collection),
    });

    assert.equal(report.instancesAnalyzed, 1);
    assert.equal(report.findings.length, 1);

    const [finding] = report.findings;
    assert.equal(finding.findingType, COST_FINDING_TYPES.PREVIOUS_GENERATION_TYPE);
    assert.equal(finding.instanceId, 'i-abc123');
    assert.equal(finding.financialImpact.currentMonthlyCost, 73);
    assert.ok(finding.financialImpact.monthlySavings > 0);
    assert.equal(finding.confidence.status, 'HIGH'); // observed cost + resolved pricing
    assert.equal(report.totalPotentialMonthlySavings, finding.financialImpact.monthlySavings);
  });

  it('reports zero-dollar findings (stopped-retained, untagged) with INSUFFICIENT_DATA financial status', async () => {
    const collection: Ec2CostCollectionResult = {
      accountId: '111111111111',
      region: 'us-east-1',
      collectedAt: new Date().toISOString(),
      costDataDegraded: false,
      instances: [
        {
          instanceId: 'i-stopped1',
          instanceType: 't3.large',
          state: 'stopped',
          region: 'us-east-1',
          launchTime: daysAgo(60),
          tags: { Environment: 'staging', Owner: 'qa' },
        },
        {
          instanceId: 'i-untagged1',
          instanceType: 't3.medium',
          state: 'running',
          region: 'us-east-1',
          launchTime: daysAgo(10),
          tags: {},
          observedMonthlyCost: 30,
        },
      ],
    };

    const report = await analyzeEc2Costs({
      analysisId: 'costan-test-2',
      tenantId: 'tenant-a',
      collection,
      dataSource: new StaticEc2CostDataSource(collection),
    });

    assert.equal(report.findings.length, 2);
    for (const finding of report.findings) {
      assert.equal(finding.financialImpact.status, 'INSUFFICIENT_DATA');
      assert.equal(finding.financialImpact.monthlySavings, 0);
    }
    assert.equal(report.totalPotentialMonthlySavings, 0);
  });

  it('marks confidence lower when cost data was estimated rather than observed', async () => {
    const collection: Ec2CostCollectionResult = {
      accountId: '111111111111',
      region: 'us-east-1',
      collectedAt: new Date().toISOString(),
      costDataDegraded: true,
      instances: [
        {
          instanceId: 'i-degraded1',
          instanceType: 'c4.large',
          state: 'running',
          region: 'us-east-1',
          launchTime: daysAgo(90),
          tags: { Environment: 'production', Owner: 'platform-team' },
          // No observedMonthlyCost — Cost Explorer was unavailable.
        },
      ],
    };

    const report = await analyzeEc2Costs({
      analysisId: 'costan-test-3',
      tenantId: 'tenant-a',
      collection,
      dataSource: new StaticEc2CostDataSource(collection),
    });

    assert.equal(report.costDataDegraded, true);
    assert.equal(report.findings.length, 1);
    assert.notEqual(report.findings[0].confidence.status, 'HIGH');
  });

  it('returns no findings when the fleet is clean', async () => {
    const collection: Ec2CostCollectionResult = {
      accountId: '111111111111',
      region: 'us-east-1',
      collectedAt: new Date().toISOString(),
      costDataDegraded: false,
      instances: [
        {
          instanceId: 'i-clean1',
          instanceType: 't3.medium',
          state: 'running',
          region: 'us-east-1',
          launchTime: daysAgo(5),
          tags: { Environment: 'production', Owner: 'platform-team' },
          observedMonthlyCost: 30,
        },
      ],
    };

    const report = await analyzeEc2Costs({
      analysisId: 'costan-test-4',
      tenantId: 'tenant-a',
      collection,
      dataSource: new StaticEc2CostDataSource(collection),
    });

    assert.equal(report.findings.length, 0);
    assert.equal(report.totalPotentialMonthlySavings, 0);
  });
});
