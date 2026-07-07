import type {
  Candidate,
  ConfidenceResult,
  Evidence,
  ExecutionResult,
  FinancialImpact,
  PluginMetadata,
  ProviderEvidenceBundle,
  QualificationResult,
  ReadinessResult,
  Recommendation,
  VerificationResult,
} from '../types';

/**
 * Optimization plugin contract.
 * Plugins describe optimization behavior only — they never call AWS directly.
 */
export interface OptimizationPlugin {
  readonly metadata: PluginMetadata;

  /** Discover resources eligible for optimization. */
  collectCandidates(): Promise<Candidate[]>;

  /** Gather raw provider data for evidence normalization by the Evidence Engine. */
  collectProviderEvidence(candidate: Candidate): Promise<ProviderEvidenceBundle>;

  /** @deprecated Sprint 2+ uses collectProviderEvidence + Evidence Engine. */
  collectEvidence(candidate: Candidate): Promise<Evidence>;

  /** Determine if a candidate is valid for analysis. */
  qualify(evidence: Evidence): Promise<QualificationResult>;

  /** Score whether the recommendation can be safely evaluated. */
  scoreReadiness(evidence: Evidence): Promise<ReadinessResult>;

  /** Score whether the recommendation should be trusted. */
  scoreConfidence(evidence: Evidence): Promise<ConfidenceResult>;

  /** Estimate financial impact of a recommendation. */
  estimateFinancialImpact(recommendation: Recommendation): Promise<FinancialImpact>;

  /** Produce an optimization recommendation. */
  recommend(evidence: Evidence): Promise<Recommendation>;

  /** Verify execution outcome against expected results. */
  verify(executionResult: ExecutionResult): Promise<VerificationResult>;
}
