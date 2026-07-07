import type {
  EvidenceRequest,
  EvidenceResult,
  FinancialImpact,
  FinancialRequest,
  GovernanceRequest,
  GovernanceResult,
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
 * Calculates financial impact of recommendations.
 */
export interface FinancialEngineInterface {
  readonly name: string;
  execute(request: FinancialRequest): Promise<Result<FinancialImpact>>;
}

/**
 * Verification Engine contract.
 * Compares expected vs observed optimization outcomes.
 */
export interface VerificationEngineInterface {
  readonly name: string;
  execute(request: VerificationRequest): Promise<Result<VerificationResult>>;
}
