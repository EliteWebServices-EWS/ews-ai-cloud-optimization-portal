import { GOVERNANCE_CONTRADICTION } from './reason-codes';
import {
  isGovernanceFailed,
  isGovernanceFailWithExecutionEligible,
  isImmatureWithReady,
} from './safety-invariants';
import type {
  GovernanceContradiction,
  GovernanceSafetyQualificationInput,
} from './types';

function contradiction(
  code: GovernanceContradiction['code'],
  message: string,
): GovernanceContradiction {
  return { code, message };
}

export function detectGovernanceContradictions(
  input: GovernanceSafetyQualificationInput,
): GovernanceContradiction[] {
  const contradictions: GovernanceContradiction[] = [];
  const { intelligence, policy, execution, verification, rollback, scope } = input;

  if (!scope.scopeVerified) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_CROSS_TENANT_SCOPE,
        'Trusted tenant/account scope verification failed.',
      ),
    );
  }

  if (isImmatureWithReady(intelligence)) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_IMMATURE_WITH_READY,
        'Evidence maturity IMMATURE cannot coexist with readiness READY.',
      ),
    );
  }

  if (isGovernanceFailed(intelligence) && intelligence.readiness === 'READY') {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_GOVERNANCE_FAIL_WITH_READY,
        'Governance failure cannot coexist with readiness READY.',
      ),
    );
  }

  if (
    (intelligence.readiness === 'NOT_READY' ||
      policy.actionPolicyReadiness === 'NOT_READY') &&
    policy.actionPolicyExecutionEligibility === 'ELIGIBLE'
  ) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_NOT_READY_EXECUTION_ELIGIBLE,
        'NOT_READY readiness cannot be execution eligible.',
      ),
    );
  }

  if (
    isGovernanceFailWithExecutionEligible({
      intelligence,
      executionEligibility: policy.actionPolicyExecutionEligibility,
    })
  ) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_GOVERNANCE_FAIL_EXECUTION_ELIGIBLE,
        'Governance failure cannot be execution eligible.',
      ),
    );
  }

  if (
    isGovernanceFailed(intelligence) &&
    policy.mlDecisionSummary?.outcome === 'EXECUTED' &&
    policy.claimsMlAuthority === true
  ) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ML_OVERRIDES_GOVERNANCE_FAIL,
        'ML cannot override governance failure.',
      ),
    );
  }

  if (policy.claimsMlAuthority === true) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ML_EXECUTED_IS_AUTHORITY,
        'ML EXECUTED is not authorization authority.',
      ),
    );
  }

  if (policy.claimsApprovedFromConfidence === true) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_HIGH_CONFIDENCE_IMPLIES_APPROVED,
        'HIGH confidence does not imply APPROVED.',
      ),
    );
  }

  if (
    policy.approvalRequired === true &&
    policy.approvalStatus === 'NOT_REQUIRED'
  ) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_APPROVAL_REQUIRED_NOT_REQUIRED,
        'Approval required flag conflicts with NOT_REQUIRED approval status.',
      ),
    );
  }

  if (
    policy.approvalRequired === true &&
    policy.approvalStatus === 'PENDING' &&
    execution?.executionAttempted === true
  ) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_MISSING_APPROVAL_EXECUTION,
        'Execution attempted without required approval.',
      ),
    );
  }

  if (
    policy.approvalStatus === 'REJECTED' &&
    execution?.executionAttempted === true
  ) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_REJECTED_APPROVAL_EXECUTION,
        'Rejected approval cannot execute.',
      ),
    );
  }

  if (policy.approvalStale === true && execution?.executionAttempted === true) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_STALE_APPROVAL_EXECUTION,
        'Stale approval cannot authorize execution.',
      ),
    );
  }

  if (
    execution?.executionApiSucceeded === true &&
    execution?.optimizationVerified === true &&
    verification?.postActionOutcome === 'INSUFFICIENT_EVIDENCE'
  ) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_EXECUTION_API_SUCCESS_VERIFIED,
        'Execution API success is not verified optimization success.',
      ),
    );
  }

  if (
    verification?.postActionOutcome === 'RESOLVED' &&
    verification?.verificationEvidenceSufficient === false
  ) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_INSUFFICIENT_EVIDENCE_RESOLVED,
        'RESOLVED outcome requires sufficient verification evidence.',
      ),
    );
  }

  if (
    rollback?.rollbackCandidate === true &&
    rollback?.rollbackAuthorized === true &&
    rollback?.rollbackAttributionPresent !== true
  ) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ROLLBACK_CANDIDATE_AUTHORIZED,
        'Rollback authorization requires attributable privileged action.',
      ),
    );
  }

  if (
    rollback?.rollbackCandidate === true &&
    rollback?.rollbackAuthorized === true &&
    (rollback?.rollbackActorAuthorized === false ||
      rollback?.rollbackMfaVerified === false)
  ) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ROLLBACK_WITHOUT_AUTHORIZATION,
        'Rollback candidate requires privileged RBAC/MFA authorization.',
      ),
    );
  }

  if (rollback?.mlAuthorizedRollback === true) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ML_AUTHORIZED_ROLLBACK,
        'ML cannot authorize rollback.',
      ),
    );
  }

  if (rollback?.rollbackInvokedByVerification === true) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ROLLBACK_WITHOUT_AUTHORIZATION,
        'Verification cannot invoke rollback directly.',
      ),
    );
  }

  if (
    rollback?.rollbackCandidate === true &&
    rollback?.rollbackAuthorized === true &&
    rollback?.rollbackAttributionPresent === true &&
    rollback?.rollbackActorAuthorized === true &&
    rollback?.rollbackMfaVerified === true
  ) {
    // Explicit authorized rollback with attribution is allowed — no contradiction.
  } else if (
    rollback?.rollbackAuthorized === true &&
    rollback?.rollbackCandidate !== true
  ) {
    contradictions.push(
      contradiction(
        GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ROLLBACK_WITHOUT_AUTHORIZATION,
        'Rollback authorization requires rollback candidate evidence.',
      ),
    );
  }

  return contradictions;
}
