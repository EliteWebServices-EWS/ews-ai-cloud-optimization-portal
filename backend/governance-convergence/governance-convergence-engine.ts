import { GOVERNANCE_CONVERGENCE_REASON } from './reason-codes';
import type {
  GovernanceConvergenceAssessment,
  GovernanceEvidenceObservationRecord,
  GovernanceEvidenceSnapshot,
} from './types';
import { GovernanceConvergenceDataQualityError } from './errors';

/**
 * Convergence engine's own classification-rule version — distinct from the
 * underlying EC2 security analyzer's ruleVersion (carried separately on
 * `evidence.ruleVersion`/EC2_SECURITY_RULE_VERSION). Bump this only when the
 * decision table below changes in a way that could reclassify existing
 * comparisons.
 */
export const GOVERNANCE_CONVERGENCE_RULE_VERSION = '1' as const;

/**
 * Decision table (Task 2). `satisfied` is three-valued: true (compliant),
 * false (violating), or undefined (evaluated but evidence insufficient to
 * determine compliance — never coerced to false).
 *
 * | Prior      | Current    | Same mechanism (fingerprint) | State     | Reason                              |
 * |------------|------------|-------------------------------|-----------|--------------------------------------|
 * | any        | any        | unchanged                     | PRESERVED | CONTROL_STILL_SATISFIED / VIOLATION_PERSISTS_UNCHANGED / EVIDENCE_UNAVAILABLE_UNCHANGED |
 * | false      | true       | changed                       | IMPROVED  | VIOLATION_RESOLVED                   |
 * | undefined  | true       | changed                       | IMPROVED  | MECHANISM_STRENGTHENED               |
 * | true       | true       | changed                       | REPLACED  | MECHANISM_CHANGED_STILL_SATISFIED    |
 * | true       | false      | changed                       | REPLACED  | CONTROL_REGRESSED                    |
 * | undefined  | false      | changed                       | REPLACED  | VIOLATION_CONTENT_CHANGED            |
 * | true/false | undefined  | changed                       | REPLACED  | VIOLATION_CONTENT_CHANGED            |
 *
 * REPLACED is used both for "a different mechanism now governs an
 * unchanged-outcome control" and for a same-mechanism outcome regression —
 * matching the Sprint 1 precedent (docs/architecture/sprint-1-evidence-
 * governance-mapping.md) that REPLACED means "current evidence supersedes
 * previous evidence" without implying deletion, not exclusively "mechanism
 * identity changed." A true→false regression is the highest-value signal
 * this engine produces; it is intentionally never folded into PRESERVED.
 *
 * MISSING is not produced by this function — see
 * `buildMissingEvidenceAssessment` for the case where a control that had
 * prior evidence produces no current evidence at all this run. "No prior
 * evidence exists yet" (a true first sighting) is also out of scope here:
 * this function returns `null` rather than inventing a fifth state outside
 * the frozen Task 1 contract.
 */
export function assessGovernanceConvergence(input: {
  currentEvidence: GovernanceEvidenceSnapshot;
  currentObservationId: string;
  previousObservation: GovernanceEvidenceObservationRecord | null;
  evaluatedAt: string;
}): GovernanceConvergenceAssessment | null {
  const { currentEvidence, currentObservationId, previousObservation, evaluatedAt } = input;

  if (!previousObservation) {
    return null;
  }

  const previousEvidence = previousObservation.evidence;

  if (previousEvidence.check !== currentEvidence.check) {
    throw new GovernanceConvergenceDataQualityError(
      `Cannot compare evidence for different checks (${previousEvidence.check} vs ${currentEvidence.check}).`,
    );
  }

  const base = {
    previousEvidenceId: previousObservation.observationId,
    currentEvidenceId: currentObservationId,
    evaluatedAt,
    ruleVersion: GOVERNANCE_CONVERGENCE_RULE_VERSION,
  };

  if (previousEvidence.fingerprint === currentEvidence.fingerprint) {
    return {
      ...base,
      state: 'PRESERVED',
      reasonCodes: [reasonForUnchanged(currentEvidence.satisfied)],
    };
  }

  const prior = previousEvidence.satisfied;
  const current = currentEvidence.satisfied;

  if (prior !== true && current === true) {
    return {
      ...base,
      state: 'IMPROVED',
      reasonCodes: [
        prior === false
          ? GOVERNANCE_CONVERGENCE_REASON.VIOLATION_RESOLVED
          : GOVERNANCE_CONVERGENCE_REASON.MECHANISM_STRENGTHENED,
      ],
    };
  }

  if (prior === true && current === true) {
    return {
      ...base,
      state: 'REPLACED',
      reasonCodes: [GOVERNANCE_CONVERGENCE_REASON.MECHANISM_CHANGED_STILL_SATISFIED],
    };
  }

  if (prior === true && current === false) {
    return {
      ...base,
      state: 'REPLACED',
      reasonCodes: [GOVERNANCE_CONVERGENCE_REASON.CONTROL_REGRESSED],
    };
  }

  return {
    ...base,
    state: 'REPLACED',
    reasonCodes: [GOVERNANCE_CONVERGENCE_REASON.VIOLATION_CONTENT_CHANGED],
  };
}

function reasonForUnchanged(
  satisfied: boolean | undefined,
): (typeof GOVERNANCE_CONVERGENCE_REASON)[keyof typeof GOVERNANCE_CONVERGENCE_REASON] {
  if (satisfied === true) {
    return GOVERNANCE_CONVERGENCE_REASON.CONTROL_STILL_SATISFIED;
  }
  if (satisfied === false) {
    return GOVERNANCE_CONVERGENCE_REASON.VIOLATION_PERSISTS_UNCHANGED;
  }
  return GOVERNANCE_CONVERGENCE_REASON.EVIDENCE_UNAVAILABLE_UNCHANGED;
}

/**
 * Produces the MISSING assessment for a control that had a prior observation
 * but no current evidence could be found for it this analysis run. Never
 * infer compliance from this state — the caller must not treat MISSING as
 * "resolved" or "no longer a concern".
 */
export function buildMissingEvidenceAssessment(input: {
  previousObservation: GovernanceEvidenceObservationRecord;
  evaluatedAt: string;
}): GovernanceConvergenceAssessment {
  return {
    state: 'MISSING',
    reasonCodes: [GOVERNANCE_CONVERGENCE_REASON.CURRENT_EVIDENCE_ABSENT],
    previousEvidenceId: input.previousObservation.observationId,
    currentEvidenceId: undefined,
    evaluatedAt: input.evaluatedAt,
    ruleVersion: GOVERNANCE_CONVERGENCE_RULE_VERSION,
  };
}
