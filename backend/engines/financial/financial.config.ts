/**
 * Configurable financial calculation thresholds and defaults.
 */

export interface FinancialConfig {
  /** Default currency for cost estimates. */
  currency: string;
  /** Decimal precision for monetary values. */
  monetaryPrecision: number;
  /** Decimal precision for percentage values. */
  percentagePrecision: number;
  /** Hours per month used for hourly-to-monthly conversion. */
  hoursPerMonth: number;
  /** Minimum monthly savings to report as meaningful. */
  minMonthlySavingsThreshold: number;
  /** Months per year for annual savings calculation. */
  monthsPerYear: number;
}

/** Default financial configuration for Demo Mode. */
export const DEFAULT_FINANCIAL_CONFIG: FinancialConfig = {
  currency: 'USD',
  monetaryPrecision: 2,
  percentagePrecision: 1,
  hoursPerMonth: 730,
  minMonthlySavingsThreshold: 0.01,
  monthsPerYear: 12,
};
