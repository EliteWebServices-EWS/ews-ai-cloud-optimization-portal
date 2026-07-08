/**
 * Configurable confidence scoring thresholds.
 */

export interface ConfidenceConfig {
  /** Minimum score for HIGH confidence status. */
  scoreHigh: number;
  /** Minimum score for MEDIUM confidence status. */
  scoreMedium: number;
  /** Minimum metrics datapoints for full metrics-quality score. */
  minMetricsDatapoints: number;
  /** Minimum utilization history entries for historical consistency. */
  minHistoryEntries: number;
  /** Minimum observation window days for telemetry continuity. */
  minObservationWindowDays: number;
  /** CPU coefficient of variation below this is considered stable. */
  maxCpuCoefficientOfVariation: number;
}

/** Default confidence configuration for Demo Mode. */
export const DEFAULT_CONFIDENCE_CONFIG: ConfidenceConfig = {
  scoreHigh: 80,
  scoreMedium: 50,
  minMetricsDatapoints: 7,
  minHistoryEntries: 5,
  minObservationWindowDays: 7,
  maxCpuCoefficientOfVariation: 0.35,
};
