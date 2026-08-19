import { DECISION_READINESS_POLICY_VERSION } from './model-version';
import { DECISION_READINESS_REASON, type DecisionReadinessReasonCode } from './reason-codes';
import type {
  EvaluateSprint2DecisionReadinessInput,
  Sprint2DecisionReadinessResult,
} from './types';

/**
 * Conservative deterministic Sprint 2 v1 readiness policy.
 * READY requires STABLE persistence, MATURE maturity, available governance
 * context with non-MISSING convergence state, HIGH confidence, and valid
 * validation. READY ≠ APPROVED ≠ EXECUTED.
 */
export function evaluateSprint2DecisionReadiness(
  input: EvaluateSprint2DecisionReadinessInput,
): Sprint2DecisionReadinessResult {
  const reasonCodes: DecisionReadinessReasonCode[] = [];

  if (!input.validation.valid) {
    reasonCodes.push(DECISION_READINESS_REASON.VALIDATION_INVALID);
  }

  if (!input.longitudinalEvidenceAvailable) {
    reasonCodes.push(DECISION_READINESS_REASON.LONGITUDINAL_EVIDENCE_UNAVAILABLE);
  }

  if (input.persistence.state === 'STABLE') {
    reasonCodes.push(DECISION_READINESS_REASON.PERSISTENCE_STABLE);
  } else {
    reasonCodes.push(DECISION_READINESS_REASON.PERSISTENCE_NOT_STABLE);
  }

  if (input.maturity?.maturity === 'MATURE') {
    reasonCodes.push(DECISION_READINESS_REASON.MATURITY_MATURE);
  } else {
    reasonCodes.push(DECISION_READINESS_REASON.MATURITY_NOT_MATURE);
  }

  if (input.confidence.status === 'HIGH') {
    reasonCodes.push(DECISION_READINESS_REASON.CONFIDENCE_HIGH);
  } else {
    reasonCodes.push(DECISION_READINESS_REASON.CONFIDENCE_NOT_HIGH);
  }

  if (!input.governance.convergence.contextAvailable) {
    reasonCodes.push(DECISION_READINESS_REASON.GOVERNANCE_CONTEXT_UNAVAILABLE);
  }

  if (input.governance.convergence.state === 'MISSING') {
    reasonCodes.push(DECISION_READINESS_REASON.GOVERNANCE_CONVERGENCE_MISSING);
  } else if (
    input.governance.convergence.contextAvailable &&
    input.governance.convergence.state !== 'PRESERVED' &&
    input.governance.convergence.state !== 'IMPROVED' &&
    input.governance.convergence.state !== 'REPLACED'
  ) {
    reasonCodes.push(DECISION_READINESS_REASON.GOVERNANCE_CONVERGENCE_NOT_PRESERVED);
  }

  const ready =
    input.validation.valid &&
    input.longitudinalEvidenceAvailable &&
    input.persistence.state === 'STABLE' &&
    input.maturity?.maturity === 'MATURE' &&
    input.confidence.status === 'HIGH' &&
    input.governance.convergence.contextAvailable &&
    input.governance.convergence.state !== 'MISSING';

  if (ready) {
    reasonCodes.push(DECISION_READINESS_REASON.READY);
  }

  return {
    readiness: ready ? 'READY' : 'NOT_READY',
    reasonCodes,
    policyVersion: DECISION_READINESS_POLICY_VERSION,
    evaluatedAt: input.evaluatedAt,
    recommendationCategory: input.recommendationCategory,
    recommendationId: input.recommendationId,
    recommendedAction: input.recommendedAction,
    findingKey: input.findingKey,
    persistence: input.persistence,
    maturity: input.maturity,
    governance: input.governance,
    confidence: input.confidence,
    validation: { valid: input.validation.valid },
  };
}
