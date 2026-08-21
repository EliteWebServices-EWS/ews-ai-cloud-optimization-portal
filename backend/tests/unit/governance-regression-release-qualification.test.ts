import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateActionPolicy } from '../../action-policy/evaluate-action-policy';
import { qualifyGovernanceSafety } from '../../governance-regression/release-qualification';
import { GOVERNANCE_CONTRADICTION, GOVERNANCE_SAFETY_REASON } from '../../governance-regression/reason-codes';
import {
  buildBlockedGovernanceFailExecutionEligibleInput,
  buildBlockedImmatureReadyContradictionInput,
  buildBlockedMissingApprovalInput,
  buildBlockedRollbackWithoutAuthorizationInput,
  buildCrossTenantDecisionDeniedInput,
  buildInsufficientMissingPricingInput,
  buildInsufficientMissingTelemetryInput,
  buildInsufficientVerificationEvidenceInput,
  buildMlFailedSafePreservesGovernanceInput,
  buildMlHighNonAuthorityInput,
  buildSafeFullyConsistentInput,
  GOVERNANCE_REGRESSION_EVALUATED_AT,
} from '../fixtures/sprint-4-governance/governance-regression-fixtures';
import {
  buildNotReadyReadinessInput,
  buildReadyReadinessInput,
  FIXED_POLICY_EVALUATED_AT,
} from '../fixtures/action-policy/policy-fixtures';

describe('Sprint 4 governance release qualification golden vectors', () => {
  it('SAFE_FULLY_CONSISTENT', () => {
    const result = qualifyGovernanceSafety(buildSafeFullyConsistentInput());
    assert.equal(result.result, 'SAFE');
    assert.ok(result.reasonCodes.includes(GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_SAFE));
  });

  it('BLOCKED_IMMATURE_READY_CONTRADICTION', () => {
    const result = qualifyGovernanceSafety(buildBlockedImmatureReadyContradictionInput());
    assert.equal(result.result, 'BLOCKED');
    if (result.result === 'BLOCKED') {
      assert.ok(
        result.contradictions.some(
          (item) =>
            item.code === GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_IMMATURE_WITH_READY,
        ),
      );
    }
  });

  it('BLOCKED_GOVERNANCE_FAIL_EXECUTION_ELIGIBLE', () => {
    const result = qualifyGovernanceSafety(buildBlockedGovernanceFailExecutionEligibleInput());
    assert.equal(result.result, 'BLOCKED');
  });

  it('BLOCKED_MISSING_APPROVAL', () => {
    const result = qualifyGovernanceSafety(buildBlockedMissingApprovalInput());
    assert.equal(result.result, 'BLOCKED');
  });

  it('BLOCKED_ROLLBACK_WITHOUT_AUTHORIZATION', () => {
    const result = qualifyGovernanceSafety(buildBlockedRollbackWithoutAuthorizationInput());
    assert.equal(result.result, 'BLOCKED');
  });

  it('INSUFFICIENT_MISSING_TELEMETRY', () => {
    const result = qualifyGovernanceSafety(buildInsufficientMissingTelemetryInput());
    assert.equal(result.result, 'INSUFFICIENT_EVIDENCE');
    assert.ok(
      result.reasonCodes.includes(
        GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_INSUFFICIENT_TELEMETRY,
      ),
    );
  });

  it('INSUFFICIENT_MISSING_PRICING', () => {
    const result = qualifyGovernanceSafety(buildInsufficientMissingPricingInput());
    assert.equal(result.result, 'INSUFFICIENT_EVIDENCE');
    assert.ok(
      result.reasonCodes.includes(
        GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_INSUFFICIENT_PRICING,
      ),
    );
  });

  it('INSUFFICIENT_VERIFICATION_EVIDENCE', () => {
    const result = qualifyGovernanceSafety(buildInsufficientVerificationEvidenceInput());
    assert.equal(result.result, 'INSUFFICIENT_EVIDENCE');
    assert.ok(
      result.reasonCodes.includes(
        GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_INSUFFICIENT_VERIFICATION_EVIDENCE,
      ),
    );
  });

  it('ML_HIGH_NON_AUTHORITY', () => {
    const result = qualifyGovernanceSafety(buildMlHighNonAuthorityInput());
    assert.equal(result.result, 'BLOCKED');
    if (result.result === 'BLOCKED') {
      assert.ok(
        result.contradictions.some(
          (item) =>
            item.code ===
            GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ML_EXECUTED_IS_AUTHORITY,
        ),
      );
    }
    assert.ok(
      result.reasonCodes.includes(
        GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_ML_HIGH_NON_AUTHORITY,
      ),
    );
  });

  it('ML_FAILED_SAFE_PRESERVES_GOVERNANCE', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
      mlDecisionSummary: {
        eligibility: 'ML_INELIGIBLE',
        outcome: 'FAILED_SAFE',
        fallback: 'DETERMINISTIC_RULES',
      },
    });
    assert.equal(policy.approval, 'REQUIRED');
    assert.equal(policy.executionEligibility, 'NOT_ELIGIBLE');

    const result = qualifyGovernanceSafety(buildMlFailedSafePreservesGovernanceInput());
    assert.notEqual(result.result, 'SAFE');
    assert.equal(result.result, 'BLOCKED');
  });

  it('CROSS_TENANT_DECISION_DENIED', () => {
    const result = qualifyGovernanceSafety(buildCrossTenantDecisionDeniedInput());
    assert.equal(result.result, 'BLOCKED');
    assert.ok(
      result.reasonCodes.includes(
        GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_CROSS_TENANT_DENIED,
      ),
    );
  });

  it('never converts NOT_READY into SAFE production eligibility', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: GOVERNANCE_REGRESSION_EVALUATED_AT,
      decisionReadiness: buildNotReadyReadinessInput(),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });
    assert.equal(policy.executionEligibility, 'NOT_ELIGIBLE');

    const result = qualifyGovernanceSafety({
      ...buildSafeFullyConsistentInput(),
      intelligence: {
        maturity: 'MATURE',
        readiness: 'NOT_READY',
        governanceConvergenceState: 'PRESERVED',
        governanceContextAvailable: true,
        confidenceStatus: 'HIGH',
        pricingEvidenceAvailable: true,
        telemetryEvidenceAvailable: true,
      },
      policy: {
        actionPolicyApproval: policy.approval,
        actionPolicyExecutionEligibility: 'ELIGIBLE',
        actionPolicyReadiness: 'NOT_READY',
        approvalRequired: true,
        approvalStatus: 'PENDING',
      },
    });
    assert.equal(result.result, 'BLOCKED');
  });
});
