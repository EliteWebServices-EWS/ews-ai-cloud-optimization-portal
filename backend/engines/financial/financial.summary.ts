import type { FinancialImpact, FinancialSummary } from '../../shared/types';
import type { FinancialConfig } from './financial.config';

/** Human-readable financial report derived from a financial summary. */
export interface FinancialReport {
  headline: string;
  currentInstanceType: string;
  projectedInstanceType: string;
  region: string;
  currency: string;
  monthlySavings: number;
  annualSavings: number;
  percentageReduction: number;
  roi: number;
  status: FinancialSummary['status'];
  meetsSavingsThreshold: boolean;
}

/**
 * Generate a financial report from calculated impact.
 * Reusable for API summary endpoints and logging.
 */
export function generateFinancialReport(
  impact: FinancialImpact,
  config: FinancialConfig
): FinancialReport {
  const { pricing, savings, status, roi } = impact.summary;

  const headline =
    status === 'ESTIMATED'
      ? `Estimated savings of ${savings.monthlySavings} ${impact.currency}/month (${savings.percentageReduction}% reduction)`
      : status === 'INSUFFICIENT_DATA'
        ? 'No projected instance type available for savings estimation'
        : 'Pricing data unavailable for financial estimation';

  return {
    headline,
    currentInstanceType: pricing.current.instanceType,
    projectedInstanceType: pricing.projected.instanceType,
    region: pricing.region,
    currency: impact.currency,
    monthlySavings: savings.monthlySavings,
    annualSavings: savings.annualSavings,
    percentageReduction: savings.percentageReduction,
    roi,
    status,
    meetsSavingsThreshold: savings.monthlySavings >= config.minMonthlySavingsThreshold,
  };
}
