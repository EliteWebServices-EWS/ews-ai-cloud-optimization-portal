/** Configuration for deterministic verification comparison rules. */
export interface VerificationConfig {
  /** Maximum variance percentage to classify as verified. */
  verifiedVarianceTolerancePercent: number;
  /** Maximum variance percentage to classify as partial success. */
  partialVarianceTolerancePercent: number;
  /** Minimum confidence score assigned to verified outcomes. */
  verifiedConfidenceScore: number;
  /** Confidence score assigned to partial outcomes. */
  partialConfidenceScore: number;
  /** Confidence score assigned to failed outcomes. */
  failedConfidenceScore: number;
}

export const DEFAULT_VERIFICATION_CONFIG: VerificationConfig = {
  verifiedVarianceTolerancePercent: 5,
  partialVarianceTolerancePercent: 15,
  verifiedConfidenceScore: 0.95,
  partialConfidenceScore: 0.75,
  failedConfidenceScore: 0.35,
};
