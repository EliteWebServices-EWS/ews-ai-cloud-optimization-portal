import type { MLDecision } from '../persistence-intelligence/types';

/**
 * Consumer-facing ML boundary for Action Policy.
 * Engineer 3 should replace imports with the authoritative production type when available.
 */
export const ML_DECISION_FALLBACKS = [
  'DETERMINISTIC_RULES',
  'OBSERVE',
  'REJECT',
  'NONE',
] as const;

export type MlDecisionFallback = (typeof ML_DECISION_FALLBACKS)[number];

export interface MlDecisionSummary {
  eligibility: MLDecision['eligibility'];
  outcome: MLDecision['outcome'];
  fallback?: MlDecisionFallback;
  /** Optional upstream model identifier — not used for authorization. */
  modelVersion?: string;
}

export function toMlDecisionSummary(decision: MLDecision & { fallback?: MlDecisionFallback }): MlDecisionSummary {
  return {
    eligibility: decision.eligibility,
    outcome: decision.outcome,
    fallback: decision.fallback,
  };
}
