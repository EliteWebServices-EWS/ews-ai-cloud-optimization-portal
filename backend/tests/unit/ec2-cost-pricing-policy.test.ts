import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { Ec2CostRecommendationRecord } from '../../cloud-intelligence/ec2-cost/ec2-cost-models';
import {
  aggregateEc2CostSavingsSummary,
  isEc2CostSamplePricingEnabled,
  sanitizeEc2CostRecommendationForApi,
} from '../../cloud-intelligence/ec2-cost/ec2-cost-pricing-policy';
import { defaultPricingAssumptions } from '../../cloud-intelligence/ec2-cost/ec2-on-demand-pricing-catalog';

function sampleRec(
  overrides: Partial<Ec2CostRecommendationRecord> = {},
): Ec2CostRecommendationRecord {
  return {
    recommendationId: 'ec2rec-1',
    tenantId: 't',
    accountId: '111122223333',
    region: 'us-east-1',
    service: 'ec2',
    resourceType: 'INSTANCE',
    resourceId: 'i-1',
    category: 'STOPPED_WITH_STORAGE',
    severity: 'MEDIUM',
    confidenceScore: 0.5,
    confidenceLevel: 'MEDIUM',
    title: 'Advisory sample estimate',
    summary: 'Advisory estimate from controlled catalog sample pricing.',
    businessJustification: 'Review storage.',
    recommendedAction: 'Review.',
    evidenceSummary: 'evidence',
    observedValues: {},
    thresholds: {},
    pricingStatus: 'CONTROLLED_CATALOG_SAMPLE',
    pricingAssumptions: defaultPricingAssumptions('us-east-1'),
    estimatedMonthlySavings: 12,
    estimatedAnnualSavings: 144,
    currentMonthlyCost: 0,
    projectedMonthlyCost: 12,
    currency: 'USD',
    analysisRunId: 'run',
    ruleId: 'rule',
    ruleVersion: '1',
    lifecycleStatus: 'OPEN',
    findingKey: 'fk',
    firstDetectedAt: '2026-01-01T00:00:00.000Z',
    lastDetectedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('EC2 cost pricing policy', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('catalog rule results use CONTROLLED_CATALOG_SAMPLE, never VERIFIED_RATE', () => {
    const rec = sampleRec();
    assert.equal(rec.pricingStatus, 'CONTROLLED_CATALOG_SAMPLE');
    assert.notEqual(rec.pricingStatus, 'VERIFIED_RATE');
  });

  it('production default disables sample dollar amounts in API sanitization', () => {
    process.env.ENVIRONMENT = 'production';
    delete process.env.EC2_COST_SAMPLE_PRICING_ENABLED;
    assert.equal(isEc2CostSamplePricingEnabled(), false);
    const sanitized = sanitizeEc2CostRecommendationForApi(sampleRec());
    assert.equal(sanitized.estimatedMonthlySavings, undefined);
    assert.equal(sanitized.estimatedAnnualSavings, undefined);
    assert.equal(sanitized.pricingStatus, 'CONTROLLED_CATALOG_SAMPLE');
    assert.ok(sanitized.pricingAssumptions?.catalogVersion);
    assert.ok(sanitized.pricingAssumptions?.priceEffectiveDate);
  });

  it('sample estimates are excluded from validated savings aggregation when disabled', () => {
    process.env.ENVIRONMENT = 'production';
    delete process.env.EC2_COST_SAMPLE_PRICING_ENABLED;
    const summary = aggregateEc2CostSavingsSummary([sampleRec()]);
    assert.equal(summary.validatedMonthlySavings, 0);
    assert.equal(summary.sampleEstimateMonthlySavings, 0);
  });

  it('sample estimates aggregate separately when explicitly enabled', () => {
    process.env.EC2_COST_SAMPLE_PRICING_ENABLED = 'true';
    const summary = aggregateEc2CostSavingsSummary([sampleRec()]);
    assert.equal(summary.validatedMonthlySavings, 0);
    assert.equal(summary.sampleEstimateMonthlySavings, 12);
  });

  it('VERIFIED_RATE contributes only to validatedMonthlySavings', () => {
    process.env.ENVIRONMENT = 'production';
    const summary = aggregateEc2CostSavingsSummary([
      sampleRec({ pricingStatus: 'VERIFIED_RATE', estimatedMonthlySavings: 25 }),
    ]);
    assert.equal(summary.validatedMonthlySavings, 25);
    assert.equal(summary.sampleEstimateMonthlySavings, 0);
  });
});
