import type { FinancialImpact, FinancialSummary, PricingSummary, SavingsEstimate } from '../../shared/types';
import { FINANCIAL_STATUS } from '../../shared/constants';
import type { FinancialConfig } from './financial.config';

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

/** Calculate savings from current and projected cost estimates. */
export function calculateSavings(
  pricing: PricingSummary,
  config: FinancialConfig
): SavingsEstimate {
  const monthlySavings = round(
    pricing.current.monthlyCost - pricing.projected.monthlyCost,
    config.monetaryPrecision
  );
  const annualSavings = round(
    monthlySavings * config.monthsPerYear,
    config.monetaryPrecision
  );
  const percentageReduction =
    pricing.current.monthlyCost > 0
      ? round(
          (monthlySavings / pricing.current.monthlyCost) * 100,
          config.percentagePrecision
        )
      : 0;

  return { monthlySavings, annualSavings, percentageReduction };
}

/** Calculate ROI as percentage of current cost saved. */
export function calculateRoi(monthlySavings: number, currentMonthlyCost: number): number {
  if (currentMonthlyCost <= 0) {
    return 0;
  }
  return Math.round((monthlySavings / currentMonthlyCost) * 1000) / 10;
}

/** Determine financial status based on pricing and savings data. */
export function resolveFinancialStatus(
  pricing: PricingSummary,
  _savings: SavingsEstimate,
  hasProjectedTarget: boolean
): FinancialSummary['status'] {
  if (!hasProjectedTarget || pricing.current.instanceType === pricing.projected.instanceType) {
    return FINANCIAL_STATUS.INSUFFICIENT_DATA;
  }
  if (pricing.current.monthlyCost <= 0 || pricing.projected.monthlyCost <= 0) {
    return FINANCIAL_STATUS.UNAVAILABLE;
  }
  return FINANCIAL_STATUS.ESTIMATED;
}

/** Build a complete financial summary from pricing data. */
export function buildFinancialSummary(
  pricing: PricingSummary,
  config: FinancialConfig,
  hasProjectedTarget: boolean
): FinancialSummary {
  const savings = calculateSavings(pricing, config);
  const status = resolveFinancialStatus(pricing, savings, hasProjectedTarget);
  const roi = calculateRoi(savings.monthlySavings, pricing.current.monthlyCost);

  return { pricing, savings, roi, status };
}

/** Build standardized FinancialImpact from a pricing summary. */
export function calculateFinancialImpact(
  pricing: PricingSummary,
  config: FinancialConfig,
  hasProjectedTarget: boolean
): FinancialImpact {
  const summary = buildFinancialSummary(pricing, config, hasProjectedTarget);
  const { savings, status } = summary;

  return {
    currentMonthlyCost: pricing.current.monthlyCost,
    projectedMonthlyCost: pricing.projected.monthlyCost,
    monthlySavings: savings.monthlySavings,
    annualSavings: savings.annualSavings,
    percentageReduction: savings.percentageReduction,
    status,
    currency: pricing.current.currency,
    summary,
    currentCost: pricing.current.monthlyCost,
    recommendedCost: pricing.projected.monthlyCost,
    roi: summary.roi,
  };
}
