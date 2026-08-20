import type { Sprint2DecisionReadinessResult } from '../decision-readiness/types';
import type { MlDecisionReasonCode } from './reason-codes';

export type { MlDecisionReasonCode };

export const ML_ELIGIBILITY_STATES = ['ML_ELIGIBLE', 'ML_INELIGIBLE'] as const;
export type MlEligibilityState = (typeof ML_ELIGIBILITY_STATES)[number];

export const ML_OUTCOMES = ['EXECUTED', 'SKIPPED', 'FAILED_SAFE'] as const;
export type MlOutcome = (typeof ML_OUTCOMES)[number];

export const ML_FALLBACKS = [
  'DETERMINISTIC_RULES',
  'OBSERVE',
  'REJECT',
  'NONE',
] as const;
export type MlFallback = (typeof ML_FALLBACKS)[number];

export interface MlValidatedOutput {
  modelConfidence: number;
  contribution?: Record<string, unknown>;
}

/**
 * Authoritative Sprint 3 ML decision contract.
 * ML EXECUTED != APPROVED != AWS mutation authority.
 */
export interface MLDecision {
  eligibility: MlEligibilityState;
  outcome: MlOutcome;
  modelId: string | null;
  modelVersion: string | null;
  reasonCodes: readonly MlDecisionReasonCode[];
  fallback: MlFallback;
  evaluatedAt: string;
  eligibilityPolicyVersion: string;
  featureSchemaVersion?: string | null;
  inferredAt?: string | null;
  validatedOutput?: MlValidatedOutput | null;
  /** Stable evaluation identity for idempotency and ActionLog source references. */
  evaluationId: string;
}

/**
 * Explicit feature manifest — callers must supply unknowns as null, never omitted-as-success.
 */
export interface MlFeatureManifest {
  featureSchemaVersion: string | null;
  stableEpochObservationCount: number | null;
  featuresComplete: boolean | null;
  telemetryQualityAdequate: boolean | null;
}

export interface MlModelAvailability {
  available: boolean;
  modelId: string | null;
  modelVersion: string | null;
  compatible: boolean | null;
}

/** Trusted tenant/account scope for upstream feature/model context — never inferred from model output. */
export interface MlTrustedScope {
  tenantId: string;
  accountId: string;
}

export interface EvaluateMlEligibilityInput {
  evaluatedAt: string;
  decisionReadiness: Pick<
    Sprint2DecisionReadinessResult,
    'readiness' | 'validation' | 'maturity' | 'confidence' | 'governance'
  >;
  featureManifest: MlFeatureManifest;
  modelAvailability: MlModelAvailability;
}

export interface MlEligibilityResult {
  eligibility: MlEligibilityState;
  reasonCodes: MlDecisionReasonCode[];
}

export interface EvaluateMlDecisionInput {
  tenantId: string;
  accountId: string;
  featureContextScope: MlTrustedScope;
  modelContextScope: MlTrustedScope;
  correlationId: string;
  recommendationId: string;
  findingKey: string;
  resourceId: string;
  evaluatedAt: string;
  evaluationId: string;
  decisionReadiness: Sprint2DecisionReadinessResult;
  featureManifest: MlFeatureManifest;
  modelAvailability: MlModelAvailability;
}

export interface EvaluateMlDecisionResult {
  decision: MLDecision;
}
