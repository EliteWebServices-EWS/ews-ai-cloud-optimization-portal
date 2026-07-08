/**
 * Configurable recommendation decision thresholds.
 */

export interface RecommendationConfig {
  /** Minimum confidence score to recommend without deferral. */
  minConfidenceScore: number;
  /** Minimum monthly savings to recommend optimization. */
  minMonthlySavings: number;
  /** Minimum readiness score from governance. */
  minReadinessScore: number;
  /** Minimum percentage reduction to consider savings significant. */
  minPercentageReduction: number;
}

/** Default recommendation configuration for Demo Mode. */
export const DEFAULT_RECOMMENDATION_CONFIG: RecommendationConfig = {
  minConfidenceScore: 50,
  minMonthlySavings: 1,
  minReadinessScore: 50,
  minPercentageReduction: 5,
};
