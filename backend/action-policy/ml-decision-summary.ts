import type { MLDecision, MlFallback } from '../ml-decision/types';

/**
 * Consumer-facing ML boundary for Action Policy.
 * Action Policy imports summaries only — never the ML service or inference adapters.
 */
export type MlDecisionFallback = MlFallback;

export const ML_DECISION_FALLBACKS = [
  'DETERMINISTIC_RULES',
  'OBSERVE',
  'REJECT',
  'NONE',
] as const satisfies readonly MlDecisionFallback[];

export interface MlDecisionSummary {
  eligibility: MLDecision['eligibility'];
  outcome: MLDecision['outcome'];
  fallback: MlDecisionFallback;
  modelVersion?: string | null;
}

export function toMlDecisionSummary(decision: MLDecision): MlDecisionSummary {
  return {
    eligibility: decision.eligibility,
    outcome: decision.outcome,
    fallback: decision.fallback,
    modelVersion: decision.modelVersion,
  };
}
