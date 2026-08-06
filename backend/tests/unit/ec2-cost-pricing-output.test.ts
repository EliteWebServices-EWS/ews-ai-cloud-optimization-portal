import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  defaultPricingAssumptions,
  EC2_ON_DEMAND_CATALOG_VERSION,
} from '../../cloud-intelligence/ec2-cost/ec2-on-demand-pricing-catalog';
import type { Ec2CostRecommendationRecord } from '../../cloud-intelligence/ec2-cost/ec2-cost-models';
import { buildEc2CostFindingKey } from '../../database/cloud-resources/ec2-cost-keys';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import { Ec2CostAnalysisApiService } from '../../services/ec2-cost-analysis-api-service';
import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';

const TENANT = 'tenant-pricing-out';
const ACCOUNT = '111122223333';

describe('EC2 cost pricing API output language', () => {
  it('recommendation records expose controlled catalog pricing metadata, not live AWS rates', async () => {
    const assumptions = defaultPricingAssumptions('us-east-1');
    const rec: Ec2CostRecommendationRecord = {
      recommendationId: 'ec2rec-pricing',
      tenantId: TENANT,
      accountId: ACCOUNT,
      region: 'us-east-1',
      service: 'ec2',
      resourceType: 'INSTANCE',
      resourceId: 'i-1',
      category: 'REVIEW_DOWNSIZE',
      severity: 'LOW',
      confidenceScore: 0.7,
      confidenceLevel: 'MEDIUM',
      title: 'Review downsizing (advisory)',
      summary: 'Advisory estimate from controlled catalog sample pricing.',
      businessJustification: 'Lower CPU may allow smaller type after validation.',
      recommendedAction: 'Validate workload and consider downsizing.',
      evidenceSummary: 'CPU below threshold.',
      observedValues: {},
      thresholds: {},
      pricingStatus: 'CONTROLLED_CATALOG_SAMPLE',
      pricingAssumptions: assumptions,
      estimatedMonthlySavings: 5,
      estimatedAnnualSavings: 60,
      currency: 'USD',
      analysisRunId: 'run-1',
      ruleId: 'underutilized',
      ruleVersion: '1',
      lifecycleStatus: 'OPEN',
      findingKey: buildEc2CostFindingKey({
        tenantId: TENANT,
        accountId: ACCOUNT,
        region: 'us-east-1',
        resourceId: 'i-1',
        category: 'REVIEW_DOWNSIZE',
        ruleVersion: '1',
      }),
      firstDetectedAt: '2026-01-01T00:00:00.000Z',
      lastDetectedAt: '2026-01-01T00:00:00.000Z',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const costRepo = new MockEc2CostRepository();
    costRepo.seedRecommendation(rec);
    const service = new Ec2CostAnalysisApiService(
      new MockAwsAccountRepository(),
      new MockEc2CloudResourceRepository(),
      costRepo,
      costRepo,
    );
    const loaded = await service.getRecommendation(TENANT, ACCOUNT, 'ec2rec-pricing');
    assert.equal(loaded.pricingAssumptions?.pricingSource, 'CONTROLLED_CATALOG_SAMPLE');
    assert.equal(loaded.pricingAssumptions?.catalogVersion, EC2_ON_DEMAND_CATALOG_VERSION);
    assert.ok(loaded.pricingAssumptions?.priceEffectiveDate);

    const blob = JSON.stringify(loaded);
    assert.doesNotMatch(blob, /current AWS price|live AWS billing|authoritative AWS rate/i);
    assert.match(loaded.summary, /advisory|controlled catalog/i);
  });
});
