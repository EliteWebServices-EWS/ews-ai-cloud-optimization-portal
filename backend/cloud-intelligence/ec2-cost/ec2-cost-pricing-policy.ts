import type { Ec2CostRecommendationRecord } from './ec2-cost-models';

/**
 * When false (production default), catalog sample dollar amounts are omitted from API responses.
 * Set EC2_COST_SAMPLE_PRICING_ENABLED=true only for local/test/demo with explicit approval.
 */
export function isEc2CostSamplePricingEnabled(): boolean {
  const explicit = process.env.EC2_COST_SAMPLE_PRICING_ENABLED;
  if (explicit === 'true') {
    return true;
  }
  if (explicit === 'false') {
    return false;
  }
  const environment = (process.env.ENVIRONMENT ?? process.env.NODE_ENV ?? '').toLowerCase();
  if (environment === 'production' || environment === 'prod') {
    return false;
  }
  if (process.env.NODE_ENV === 'test') {
    return true;
  }
  return false;
}

export function sanitizeEc2CostRecommendationForApi(
  record: Ec2CostRecommendationRecord,
): Ec2CostRecommendationRecord {
  const sampleEnabled = isEc2CostSamplePricingEnabled();
  if (record.pricingStatus === 'VERIFIED_RATE') {
    return record;
  }
  if (record.pricingStatus === 'CONTROLLED_CATALOG_SAMPLE' && sampleEnabled) {
    return record;
  }
  if (record.pricingStatus === 'CONTROLLED_CATALOG_SAMPLE' && !sampleEnabled) {
    return {
      ...record,
      currentMonthlyCost: undefined,
      projectedMonthlyCost: undefined,
      estimatedMonthlySavings: undefined,
      estimatedAnnualSavings: undefined,
      currency: undefined,
    };
  }
  return {
    ...record,
    currentMonthlyCost: undefined,
    projectedMonthlyCost: undefined,
    estimatedMonthlySavings: undefined,
    estimatedAnnualSavings: undefined,
    currency: undefined,
  };
}

export interface Ec2CostSavingsAggregation {
  validatedMonthlySavings: number;
  sampleEstimateMonthlySavings: number;
  currency: 'USD';
}

export function aggregateEc2CostSavingsSummary(
  records: Ec2CostRecommendationRecord[],
): Ec2CostSavingsAggregation {
  let validatedMonthlySavings = 0;
  let sampleEstimateMonthlySavings = 0;
  const sampleEnabled = isEc2CostSamplePricingEnabled();

  for (const record of records) {
    const monthly = record.estimatedMonthlySavings ?? 0;
    if (monthly <= 0) {
      continue;
    }
    if (record.pricingStatus === 'VERIFIED_RATE') {
      validatedMonthlySavings += monthly;
    } else if (
      record.pricingStatus === 'CONTROLLED_CATALOG_SAMPLE' &&
      sampleEnabled
    ) {
      sampleEstimateMonthlySavings += monthly;
    }
  }

  return {
    validatedMonthlySavings: roundUsd(validatedMonthlySavings),
    sampleEstimateMonthlySavings: roundUsd(sampleEstimateMonthlySavings),
    currency: 'USD',
  };
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}
