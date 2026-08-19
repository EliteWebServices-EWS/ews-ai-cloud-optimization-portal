import type { GovernanceConvergenceState } from '../governance-convergence/types';
import type { PersistenceState, EvidenceMaturity } from '../persistence-intelligence/types';
import type { ConfidenceResult, EvidenceValidationResult } from '../shared/types';
import type { DecisionReadinessReasonCode } from './reason-codes';

export const DECISION_READINESS_STATES = ['READY', 'NOT_READY'] as const;
export type DecisionReadinessState = (typeof DECISION_READINESS_STATES)[number];

/**
 * Explicit governance convergence slice supplied by the authoritative
 * governance-convergence contract. Domain-separated pipelines must not infer
 * governance from resourceId alone.
 */
export interface DecisionReadinessGovernanceConvergenceContext {
  state: GovernanceConvergenceState;
  reasonCodes: readonly string[];
  ruleVersion: string;
  contextAvailable: boolean;
}

export interface DecisionReadinessPersistenceProvenance {
  state: PersistenceState;
  persistenceHours: number | null;
  reasonCodes: readonly string[];
  sourceObservationId: string;
  logicalObservationId: string;
  ruleId: string;
  ruleVersion: string;
}

export interface DecisionReadinessMaturityProvenance {
  maturity: EvidenceMaturity;
  reasonCodes: readonly string[];
  modelVersion: string;
  sourceObservationId: string;
  sourceLogicalObservationId: string;
  stableEpochObservationCount: number;
  stableEpochHours: number;
  persistenceHours: number | null;
}

export interface DecisionReadinessConfidenceProvenance {
  status: ConfidenceResult['status'];
  score: number;
  commercialScore: number;
  reasonCodes: readonly string[];
  formulaVersion: string;
  confidenceModelVersion: string;
}

export interface DecisionReadinessGovernanceProvenance {
  convergence: DecisionReadinessGovernanceConvergenceContext;
}

/**
 * Sprint 2 canonical cross-layer readiness result.
 * READY is evidence/decision-readiness only — not approval or execution.
 */
export interface Sprint2DecisionReadinessResult {
  readiness: DecisionReadinessState;
  reasonCodes: DecisionReadinessReasonCode[];
  policyVersion: string;
  evaluatedAt: string;
  /** Upstream EC2 cost recommendation category / finding identity, e.g. BURSTABLE_CREDIT_PRESSURE. */
  recommendationCategory: string;
  recommendationId: string;
  recommendedAction: string;
  findingKey: string;
  persistence: DecisionReadinessPersistenceProvenance;
  maturity?: DecisionReadinessMaturityProvenance;
  governance: DecisionReadinessGovernanceProvenance;
  confidence: DecisionReadinessConfidenceProvenance;
  validation: Pick<EvidenceValidationResult, 'valid'>;
}

export interface EvaluateSprint2DecisionReadinessInput {
  tenantId: string;
  accountId: string;
  findingKey: string;
  recommendationCategory: string;
  recommendationId: string;
  recommendedAction: string;
  resourceId: string;
  evaluatedAt: string;
  validation: EvidenceValidationResult;
  longitudinalEvidenceAvailable: boolean;
  persistence: DecisionReadinessPersistenceProvenance;
  maturity?: DecisionReadinessMaturityProvenance;
  governance: DecisionReadinessGovernanceProvenance;
  confidence: DecisionReadinessConfidenceProvenance;
}
