import type {
  ConfidenceRequest,
  ConfidenceResult,
  EvidenceRequest,
  EvidenceResult,
  FinancialImpact,
  FinancialRequest,
  GovernanceRequest,
  GovernanceResult,
  RecommendationDecision,
  RecommendationRequest,
  Result,
  VerificationRequest,
  VerificationResult,
} from '../types';

/**
 * Evidence Engine contract.
 * Collects, normalizes, and validates provider data into Evidence objects.
 */
export interface EvidenceEngineInterface {
  readonly name: string;
  execute(request: EvidenceRequest): Promise<Result<EvidenceResult>>;
}

/**
 * Governance Engine contract.
 * Evaluates policies and produces governance decisions.
 */
export interface GovernanceEngineInterface {
  readonly name: string;
  execute(request: GovernanceRequest): Promise<Result<GovernanceResult>>;
}

/**
 * Financial Engine contract.
 * Calculates financial impact from evidence and provider pricing.
 */
export interface FinancialEngineInterface {
  readonly name: string;
  execute(request: FinancialRequest): Promise<Result<FinancialImpact>>;
}

/**
 * Confidence Engine contract.
 * Evaluates trust in optimization decisions separately from readiness.
 */
export interface ConfidenceEngineInterface {
  readonly name: string;
  execute(request: ConfidenceRequest): Promise<Result<ConfidenceResult>>;
}

/**
 * Recommendation Engine contract.
 * Combines upstream engine outputs into an optimization recommendation decision.
 */
export interface RecommendationEngineInterface {
  readonly name: string;
  execute(request: RecommendationRequest): Promise<Result<RecommendationDecision>>;
}

/**
 * Verification Engine contract.
 * Compares expected vs observed optimization outcomes.
 */
export interface VerificationEngineInterface {
  readonly name: string;
  execute(request: VerificationRequest): Promise<Result<VerificationResult>>;
}
