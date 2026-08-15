import type { MLDecision } from '../../../persistence-intelligence/types';

/**
 * Sprint 3 fixture representation only — no production ML execution path exists in Sprint 1.
 * Documents expected ineligible eligibility for future tests.
 */
export function buildMlIneligibleDecision(): MLDecision {
  return {
    eligibility: 'ML_INELIGIBLE',
    outcome: 'SKIPPED',
  };
}

export function buildMlEligibleSkippedDecision(): MLDecision {
  return {
    eligibility: 'ML_ELIGIBLE',
    outcome: 'SKIPPED',
  };
}
