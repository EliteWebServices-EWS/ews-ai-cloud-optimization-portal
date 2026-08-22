import { GOVERNANCE_REGRESSION_REASON } from './reason-codes';
import type { DecisionLifecycleSnapshot, InvariantViolation } from './types';

/**
 * Task 2 — canonical release-blocking safety invariants.
 *
 * Each function is a pure predicate over an already-computed
 * DecisionLifecycleSnapshot. None of these functions compute governance,
 * readiness, approval, or execution eligibility — they only check that the
 * relationships between stages that already ran are safe.
 *
 * `null` returned = invariant not violated (either satisfied, or not
 * applicable to this snapshot). Never treat "not applicable" as "safe" at
 * the call site without also checking evidence completeness separately —
 * see missing-evidence.ts.
 */

function governanceFailed(snapshot: DecisionLifecycleSnapshot): boolean {
  const { governance } = snapshot;
  if (!governance.contextAvailable) {
    return false;
  }
  if (governance.legacyStatus === 'FAIL') {
    return true;
  }
  return governance.convergenceState === 'MISSING';
}

/** IMMATURE ≠ READY */
export function checkImmatureNotReady(
  snapshot: DecisionLifecycleSnapshot,
): InvariantViolation | null {
  if (
    snapshot.evidenceMaturity.available &&
    snapshot.evidenceMaturity.maturity === 'IMMATURE' &&
    snapshot.decisionReadiness.available &&
    snapshot.decisionReadiness.readiness === 'READY'
  ) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.INVARIANT_IMMATURE_NOT_READY,
      detail: 'Evidence maturity is IMMATURE but decision readiness is READY.',
    };
  }
  return null;
}

/** NOT_READY cannot execute */
export function checkNotReadyCannotExecute(
  snapshot: DecisionLifecycleSnapshot,
): InvariantViolation | null {
  if (
    snapshot.decisionReadiness.available &&
    snapshot.decisionReadiness.readiness === 'NOT_READY' &&
    snapshot.actionPolicy.available &&
    snapshot.actionPolicy.executionEligibility === 'ELIGIBLE'
  ) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.INVARIANT_NOT_READY_CANNOT_EXECUTE,
      detail: 'Decision readiness is NOT_READY but execution eligibility is ELIGIBLE.',
    };
  }
  return null;
}

/** governance FAIL cannot be overridden by ML */
export function checkGovernanceFailNotOverridableByMl(
  snapshot: DecisionLifecycleSnapshot,
): InvariantViolation | null {
  if (!governanceFailed(snapshot)) {
    return null;
  }

  const executionOverridden =
    snapshot.actionPolicy.available &&
    snapshot.actionPolicy.executionEligibility === 'ELIGIBLE';
  const mlExecutedThroughFailedGovernance =
    snapshot.mlDecision.present && snapshot.mlDecision.outcome === 'EXECUTED';

  if (executionOverridden || mlExecutedThroughFailedGovernance) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.INVARIANT_GOVERNANCE_FAIL_NOT_OVERRIDABLE_BY_ML,
      detail:
        'Governance evaluation failed but execution eligibility is ELIGIBLE or ML reported EXECUTED.',
    };
  }
  return null;
}

/** HIGH confidence ≠ APPROVED */
export function checkHighConfidenceNotApproval(
  snapshot: DecisionLifecycleSnapshot,
): InvariantViolation | null {
  if (
    snapshot.confidence.available &&
    snapshot.confidence.status === 'HIGH' &&
    snapshot.approval.available &&
    snapshot.approval.approvalStatus === 'APPROVED' &&
    snapshot.approval.approvalSource === 'INFERRED_FROM_CONFIDENCE'
  ) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.INVARIANT_HIGH_CONFIDENCE_NOT_APPROVAL,
      detail: 'Approval status APPROVED was inferred from HIGH confidence rather than recorded human approval.',
    };
  }

  // A human-recorded approval without an attributable actor is equally unsafe,
  // regardless of the confidence level that accompanied it.
  if (
    snapshot.approval.available &&
    snapshot.approval.approvalStatus === 'APPROVED' &&
    !snapshot.approval.approvalActorId
  ) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.INVARIANT_HIGH_CONFIDENCE_NOT_APPROVAL,
      detail: 'Approval status APPROVED has no attributable approving actor.',
    };
  }

  return null;
}

/** ML EXECUTED ≠ AUTHORITY */
export function checkMlExecutedNotAuthority(
  snapshot: DecisionLifecycleSnapshot,
): InvariantViolation | null {
  if (
    snapshot.mlDecision.present &&
    snapshot.mlDecision.outcome === 'EXECUTED' &&
    !snapshot.mlDecision.actionPolicyRecordedNonAuthority
  ) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.INVARIANT_ML_EXECUTED_NOT_AUTHORITY,
      detail:
        'ML decision outcome is EXECUTED but action policy did not record the ML non-authority reason code.',
    };
  }
  return null;
}

/** ML FAILED_SAFE cannot weaken governance */
export function checkMlFailedSafeCannotWeakenGovernance(
  snapshot: DecisionLifecycleSnapshot,
): InvariantViolation | null {
  if (
    snapshot.mlDecision.present &&
    snapshot.mlDecision.outcome === 'FAILED_SAFE' &&
    snapshot.actionPolicy.available &&
    (snapshot.actionPolicy.approval === 'NOT_REQUIRED' ||
      snapshot.actionPolicy.executionEligibility === 'ELIGIBLE') &&
    !snapshot.actionPolicy.reasonCodes.includes(
      'ACTION_POLICY_ML_FAILED_SAFE_APPROVAL_UNCHANGED',
    )
  ) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.INVARIANT_ML_FAILED_SAFE_MUST_NOT_WEAKEN_GOVERNANCE,
      detail:
        'ML decision outcome is FAILED_SAFE but action policy approval/eligibility changed without the failed-safe-unchanged reason code.',
    };
  }
  return null;
}

/** APPROVAL REQUIRED + missing approval cannot execute */
export function checkApprovalRequiredMissingCannotExecute(
  snapshot: DecisionLifecycleSnapshot,
): InvariantViolation | null {
  if (
    snapshot.actionPolicy.available &&
    snapshot.actionPolicy.approval === 'REQUIRED' &&
    snapshot.approval.approvalStatus !== 'APPROVED' &&
    snapshot.actionPolicy.executionEligibility === 'ELIGIBLE'
  ) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.INVARIANT_APPROVAL_REQUIRED_MISSING_CANNOT_EXECUTE,
      detail: 'Approval is REQUIRED and not APPROVED but execution eligibility is ELIGIBLE.',
    };
  }
  return null;
}

/** API execution success ≠ optimization success */
export function checkApiSuccessNotOptimizationSuccess(
  snapshot: DecisionLifecycleSnapshot,
): InvariantViolation | null {
  if (
    snapshot.execution.attempted &&
    snapshot.execution.apiSuccess === true &&
    !snapshot.verification.present
  ) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.INVARIANT_API_SUCCESS_NOT_OPTIMIZATION_SUCCESS,
      detail:
        'Execution API call succeeded but no post-action verification evidence exists to confirm the optimization succeeded.',
    };
  }
  return null;
}

/** INSUFFICIENT_EVIDENCE ≠ successful verification */
export function checkInsufficientEvidenceNotSuccessfulVerification(
  snapshot: DecisionLifecycleSnapshot,
): InvariantViolation | null {
  if (
    snapshot.verification.present &&
    snapshot.verification.outcome === 'INSUFFICIENT_EVIDENCE' &&
    snapshot.verification.incorrectlyMarkedResolved
  ) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.INVARIANT_INSUFFICIENT_EVIDENCE_NOT_SUCCESSFUL_VERIFICATION,
      detail: 'Verification outcome is INSUFFICIENT_EVIDENCE but the record was marked resolved.',
    };
  }
  return null;
}

/** ROLLBACK_CANDIDATE ≠ rollback authorization */
export function checkRollbackCandidateNotAuthorization(
  snapshot: DecisionLifecycleSnapshot,
): InvariantViolation | null {
  const { rollback } = snapshot;
  if (!rollback.authorized) {
    return null;
  }

  const authorizationUnattributed = !rollback.authorizedByActorId || !rollback.authorizedAt;
  const authorizedByCandidateFlagAlone =
    rollback.candidateFlagged && authorizationUnattributed;

  if (
    authorizedByCandidateFlagAlone ||
    rollback.authorizedByMl ||
    rollback.authorizedByVerificationDirectly
  ) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.INVARIANT_ROLLBACK_CANDIDATE_NOT_AUTHORIZATION,
      detail:
        'Rollback is marked authorized without an attributable independent authorization actor, or was authorized by ML/verification directly.',
    };
  }
  return null;
}

const ALL_INVARIANT_CHECKS: Array<
  (snapshot: DecisionLifecycleSnapshot) => InvariantViolation | null
> = [
  checkImmatureNotReady,
  checkNotReadyCannotExecute,
  checkGovernanceFailNotOverridableByMl,
  checkHighConfidenceNotApproval,
  checkMlExecutedNotAuthority,
  checkMlFailedSafeCannotWeakenGovernance,
  checkApprovalRequiredMissingCannotExecute,
  checkApiSuccessNotOptimizationSuccess,
  checkInsufficientEvidenceNotSuccessfulVerification,
  checkRollbackCandidateNotAuthorization,
];

export function evaluateSafetyInvariants(
  snapshot: DecisionLifecycleSnapshot,
): InvariantViolation[] {
  return ALL_INVARIANT_CHECKS.map((check) => check(snapshot)).filter(
    (violation): violation is InvariantViolation => violation !== null,
  );
}
