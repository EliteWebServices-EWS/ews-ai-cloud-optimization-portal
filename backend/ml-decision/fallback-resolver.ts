import { ML_DECISION_REASON } from './reason-codes';
import type { MlDecisionReasonCode, MlFallback, MlOutcome, MlEligibilityState } from './types';

export function resolveMlFallback(input: {
  eligibility: MlEligibilityState;
  outcome: MlOutcome;
  reasonCodes: readonly MlDecisionReasonCode[];
}): MlFallback {
  if (input.reasonCodes.includes(ML_DECISION_REASON.ML_FALLBACK_REJECT)) {
    return 'REJECT';
  }

  if (input.reasonCodes.includes(ML_DECISION_REASON.ML_INELIGIBLE_EVIDENCE_INVALID)) {
    return 'REJECT';
  }

  if (input.reasonCodes.includes(ML_DECISION_REASON.ML_INELIGIBLE_EVIDENCE_IMMATURE)) {
    return 'OBSERVE';
  }

  if (input.outcome === 'FAILED_SAFE') {
    return 'DETERMINISTIC_RULES';
  }

  if (input.eligibility === 'ML_INELIGIBLE' && input.outcome === 'SKIPPED') {
    if (input.reasonCodes.includes(ML_DECISION_REASON.ML_SKIPPED_FEATURE_UNAVAILABLE)) {
      return 'DETERMINISTIC_RULES';
    }
    if (input.reasonCodes.includes(ML_DECISION_REASON.ML_INELIGIBLE_INSUFFICIENT_HISTORY)) {
      return 'DETERMINISTIC_RULES';
    }
    return 'DETERMINISTIC_RULES';
  }

  if (input.outcome === 'EXECUTED') {
    return 'NONE';
  }

  if (input.reasonCodes.includes(ML_DECISION_REASON.ML_LOW_MODEL_CONFIDENCE)) {
    return 'OBSERVE';
  }

  return 'NONE';
}

export function appendFallbackReason(
  fallback: MlFallback,
  reasonCodes: MlDecisionReasonCode[],
): MlDecisionReasonCode[] {
  switch (fallback) {
    case 'DETERMINISTIC_RULES':
      return [...reasonCodes, ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES];
    case 'OBSERVE':
      return [...reasonCodes, ML_DECISION_REASON.ML_FALLBACK_OBSERVE];
    case 'REJECT':
      return [...reasonCodes, ML_DECISION_REASON.ML_FALLBACK_REJECT];
    default:
      return reasonCodes;
  }
}
