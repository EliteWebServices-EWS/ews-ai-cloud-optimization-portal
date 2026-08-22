import { GOVERNANCE_REGRESSION_POLICY_VERSION } from './model-version';
import { GOVERNANCE_REGRESSION_REASON, type GovernanceRegressionReasonCode } from './reason-codes';
import { evaluateSafetyInvariants } from './invariants';
import { detectContradictions } from './contradiction-detector';
import type { DecisionLifecycleSnapshot, ReleaseSafetyGateResult } from './types';

function uniqueCodes(
  codes: GovernanceRegressionReasonCode[],
): GovernanceRegressionReasonCode[] {
  return [...new Set(codes)];
}

/**
 * Which stages must be present for the gate to render a verdict at all.
 * Missing evidence is reported as its own reason code and forces
 * INSUFFICIENT_EVIDENCE — it is never silently treated as SAFE.
 */
function evaluateMissingEvidence(
  snapshot: DecisionLifecycleSnapshot,
): GovernanceRegressionReasonCode[] {
  const missing: GovernanceRegressionReasonCode[] = [];

  if (!snapshot.decisionReadiness.available) {
    missing.push(GOVERNANCE_REGRESSION_REASON.EVIDENCE_MISSING_DECISION_READINESS);
  }
  if (!snapshot.actionPolicy.available) {
    missing.push(GOVERNANCE_REGRESSION_REASON.EVIDENCE_MISSING_ACTION_POLICY);
  }
  if (!snapshot.governance.contextAvailable) {
    missing.push(GOVERNANCE_REGRESSION_REASON.EVIDENCE_MISSING_GOVERNANCE_CONTEXT);
  }
  if (snapshot.actionPolicy.approval === 'REQUIRED' && !snapshot.approval.available) {
    missing.push(GOVERNANCE_REGRESSION_REASON.EVIDENCE_MISSING_APPROVAL_CONTEXT);
  }

  return missing;
}

/**
 * Task 8 — Release-Blocking Safety Gate.
 *
 * This is a release-qualification verdict, not a runtime governance
 * engine: it never sets readiness, governance, approval, or execution
 * eligibility, and it must never be called from the runtime decision path.
 * It only classifies a snapshot of already-computed stage outputs as
 * SAFE, BLOCKED, or INSUFFICIENT_EVIDENCE for the purpose of qualifying a
 * release / regression run.
 *
 * Precedence: missing critical evidence -> INSUFFICIENT_EVIDENCE always
 * wins over a SAFE verdict (we must not certify SAFE on partial data), but
 * an actual invariant violation or contradiction always wins over
 * INSUFFICIENT_EVIDENCE (an unsafe combination found in what evidence
 * *does* exist is still unsafe regardless of what's missing elsewhere).
 */
export function evaluateReleaseSafetyGate(
  snapshot: DecisionLifecycleSnapshot,
): ReleaseSafetyGateResult {
  const invariantViolations = evaluateSafetyInvariants(snapshot);
  const contradictions = detectContradictions(snapshot);
  const missingEvidence = evaluateMissingEvidence(snapshot);

  const unsafe = invariantViolations.length > 0 || contradictions.length > 0;

  let result: ReleaseSafetyGateResult['result'];
  const reasonCodes: GovernanceRegressionReasonCode[] = [];

  if (unsafe) {
    result = 'BLOCKED';
    if (invariantViolations.length > 0) {
      reasonCodes.push(GOVERNANCE_REGRESSION_REASON.GATE_BLOCKED_INVARIANT_VIOLATION);
    }
    if (contradictions.length > 0) {
      reasonCodes.push(GOVERNANCE_REGRESSION_REASON.GATE_BLOCKED_CONTRADICTION);
    }
  } else if (missingEvidence.length > 0) {
    result = 'INSUFFICIENT_EVIDENCE';
    reasonCodes.push(GOVERNANCE_REGRESSION_REASON.GATE_INSUFFICIENT_EVIDENCE);
  } else {
    result = 'SAFE';
    reasonCodes.push(GOVERNANCE_REGRESSION_REASON.GATE_SAFE);
  }

  return {
    result,
    reasonCodes: uniqueCodes([
      ...reasonCodes,
      ...invariantViolations.map((violation) => violation.code),
      ...contradictions.map((contradiction) => contradiction.code),
      ...missingEvidence,
    ]),
    invariantViolations,
    contradictions,
    missingEvidence,
    policyVersion: GOVERNANCE_REGRESSION_POLICY_VERSION,
    evaluatedAt: snapshot.evaluatedAt,
    decisionId: snapshot.decisionId,
    correlationId: snapshot.correlationId,
  };
}
