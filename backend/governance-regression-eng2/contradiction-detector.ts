import { GOVERNANCE_REGRESSION_REASON } from './reason-codes';
import type { Contradiction, DecisionLifecycleSnapshot } from './types';

/**
 * Task 4 — contradiction detection.
 *
 * These are impossible/unsafe *combinations* of already-recorded state,
 * as opposed to invariants.ts's stage-relationship rules. A contradiction
 * means the historical record itself is internally inconsistent: it is
 * never corrected here. This module only reports it with a stable reason
 * code — callers (release qualification, operator review, provenance
 * tooling) decide what to do with a contradictory historical record. This
 * module never rewrites, deletes, or "fixes" the underlying stored data.
 */

function detectMaturityImmatureReadinessReady(
  snapshot: DecisionLifecycleSnapshot,
): Contradiction | null {
  if (
    snapshot.evidenceMaturity.available &&
    snapshot.evidenceMaturity.maturity === 'IMMATURE' &&
    snapshot.decisionReadiness.available &&
    snapshot.decisionReadiness.readiness === 'READY'
  ) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.CONTRADICTION_MATURITY_IMMATURE_READINESS_READY,
      detail: 'Maturity=IMMATURE recorded alongside readiness=READY on the same decision.',
    };
  }
  return null;
}

function detectGovernanceFailExecutionEligible(
  snapshot: DecisionLifecycleSnapshot,
): Contradiction | null {
  const failed =
    snapshot.governance.contextAvailable &&
    (snapshot.governance.legacyStatus === 'FAIL' ||
      snapshot.governance.convergenceState === 'MISSING');

  if (
    failed &&
    snapshot.actionPolicy.available &&
    snapshot.actionPolicy.executionEligibility === 'ELIGIBLE'
  ) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.CONTRADICTION_GOVERNANCE_FAIL_EXECUTION_ELIGIBLE,
      detail: 'Governance=FAIL/MISSING recorded alongside executionEligibility=ELIGIBLE.',
    };
  }
  return null;
}

function detectApprovalRequiredStatusNotRequired(
  snapshot: DecisionLifecycleSnapshot,
): Contradiction | null {
  if (
    snapshot.actionPolicy.available &&
    snapshot.actionPolicy.approval === 'REQUIRED' &&
    snapshot.approval.approvalStatus === 'NOT_REQUIRED'
  ) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.CONTRADICTION_APPROVAL_REQUIRED_STATUS_NOT_REQUIRED,
      detail: 'Action policy approval=REQUIRED recorded alongside approvalStatus=NOT_REQUIRED.',
    };
  }
  return null;
}

function detectVerificationInsufficientEvidenceMarkedResolved(
  snapshot: DecisionLifecycleSnapshot,
): Contradiction | null {
  if (
    snapshot.verification.present &&
    snapshot.verification.outcome === 'INSUFFICIENT_EVIDENCE' &&
    snapshot.verification.incorrectlyMarkedResolved
  ) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.CONTRADICTION_VERIFICATION_INSUFFICIENT_EVIDENCE_MARKED_RESOLVED,
      detail: 'Verification outcome=INSUFFICIENT_EVIDENCE recorded alongside a RESOLVED marker.',
    };
  }
  return null;
}

function detectRollbackEvidenceInsufficientButAuthorized(
  snapshot: DecisionLifecycleSnapshot,
): Contradiction | null {
  if (snapshot.rollback.evidenceSufficient === false && snapshot.rollback.authorized) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.CONTRADICTION_ROLLBACK_EVIDENCE_INSUFFICIENT_BUT_AUTHORIZED,
      detail: 'Rollback evidenceSufficient=false recorded alongside authorized=true.',
    };
  }
  return null;
}

function detectCrossTenantDecisionInput(
  snapshot: DecisionLifecycleSnapshot,
): Contradiction | null {
  const foreignScope = snapshot.observedRecordScopes.find(
    (recordScope) =>
      recordScope.tenantId !== snapshot.scope.tenantId ||
      recordScope.accountId !== snapshot.scope.accountId,
  );

  if (foreignScope) {
    return {
      code: GOVERNANCE_REGRESSION_REASON.CONTRADICTION_CROSS_TENANT_DECISION_INPUT,
      detail: `Decision scope tenant=${snapshot.scope.tenantId}/account=${snapshot.scope.accountId} includes an input record scoped to tenant=${foreignScope.tenantId}/account=${foreignScope.accountId}.`,
    };
  }
  return null;
}

const ALL_CONTRADICTION_CHECKS: Array<
  (snapshot: DecisionLifecycleSnapshot) => Contradiction | null
> = [
  detectMaturityImmatureReadinessReady,
  detectGovernanceFailExecutionEligible,
  detectApprovalRequiredStatusNotRequired,
  detectVerificationInsufficientEvidenceMarkedResolved,
  detectRollbackEvidenceInsufficientButAuthorized,
  detectCrossTenantDecisionInput,
];

export function detectContradictions(
  snapshot: DecisionLifecycleSnapshot,
): Contradiction[] {
  return ALL_CONTRADICTION_CHECKS.map((check) => check(snapshot)).filter(
    (contradiction): contradiction is Contradiction => contradiction !== null,
  );
}
