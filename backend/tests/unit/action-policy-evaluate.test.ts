import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACTION_POLICY_VERSION,
  ACTION_POLICY_REASON,
  evaluateActionPolicy,
  evaluateActionPolicyActorGate,
  evaluateProductionExecutionEligibility,
} from '../../action-policy';
import {
  buildNotReadyReadinessInput,
  buildReadyReadinessInput,
  FIXED_POLICY_EVALUATED_AT,
} from '../fixtures/action-policy/policy-fixtures';

describe('Action policy golden vectors', () => {
  it('NOT_READY_BLOCKED', () => {
    const result = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildNotReadyReadinessInput(),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(result.policyVersion, ACTION_POLICY_VERSION);
    assert.equal(result.approval, 'BLOCKED');
    assert.equal(result.executionEligibility, 'NOT_ELIGIBLE');
    assert.ok(result.reasonCodes.includes(ACTION_POLICY_REASON.READINESS_NOT_READY_BLOCKED));
  });

  it('READY_PRODUCTION_APPROVAL_REQUIRED', () => {
    const result = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(result.approval, 'REQUIRED');
    assert.equal(result.executionEligibility, 'NOT_ELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(ACTION_POLICY_REASON.PRODUCTION_INFRA_APPROVAL_REQUIRED),
    );
  });

  it('READY_SIMULATION_ALLOWED', () => {
    const result = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      actionMode: 'SIMULATION',
      infrastructureChanging: true,
    });

    assert.equal(result.approval, 'NOT_REQUIRED');
    assert.equal(result.executionEligibility, 'ELIGIBLE');
    assert.ok(result.reasonCodes.includes(ACTION_POLICY_REASON.SIMULATION_ALLOWED));
    assert.ok(result.reasonCodes.includes(ACTION_POLICY_REASON.SIMULATION_NOT_PRODUCTION));
  });

  it('READY_PRODUCTION_APPROVED_ELIGIBLE', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    const eligible = evaluateProductionExecutionEligibility({
      policy,
      approvalRequired: true,
      approvalStatus: 'APPROVED',
      planStatus: 'APPROVED',
    });

    assert.equal(eligible.executionEligibility, 'ELIGIBLE');
    assert.ok(
      eligible.reasonCodes.includes(ACTION_POLICY_REASON.PRODUCTION_APPROVED_ELIGIBLE),
    );
  });

  it('READY_PRODUCTION_REJECTED_BLOCKED', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    const rejected = evaluateProductionExecutionEligibility({
      policy,
      approvalRequired: true,
      approvalStatus: 'REJECTED',
      planStatus: 'REJECTED',
    });

    assert.equal(rejected.executionEligibility, 'NOT_ELIGIBLE');
    assert.ok(
      rejected.reasonCodes.includes(ACTION_POLICY_REASON.PRODUCTION_REJECTED_BLOCKED),
    );
  });

  it('ML_INELIGIBLE_DETERMINISTIC_FALLBACK', () => {
    const result = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: {
        eligibility: 'ML_INELIGIBLE',
        outcome: 'SKIPPED',
        fallback: 'DETERMINISTIC_RULES',
      },
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(result.approval, 'REQUIRED');
    assert.equal(result.executionEligibility, 'NOT_ELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(ACTION_POLICY_REASON.ML_DETERMINISTIC_FALLBACK_PERMITTED),
    );
  });

  it('ML_FAILED_SAFE_APPROVAL_STILL_REQUIRED', () => {
    const result = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: {
        eligibility: 'ML_ELIGIBLE',
        outcome: 'FAILED_SAFE',
        fallback: 'DETERMINISTIC_RULES',
      },
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(result.approval, 'REQUIRED');
    assert.equal(result.executionEligibility, 'NOT_ELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(ACTION_POLICY_REASON.ML_FAILED_SAFE_APPROVAL_UNCHANGED),
    );
  });

  it('ML_EXECUTED_HIGH_CONFIDENCE_NOT_AUTHORITY', () => {
    const result = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: {
        eligibility: 'ML_ELIGIBLE',
        outcome: 'EXECUTED',
        fallback: 'NONE',
      },
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(result.approval, 'REQUIRED');
    assert.notEqual(result.approval, 'APPROVED' as never);
    assert.ok(result.reasonCodes.includes(ACTION_POLICY_REASON.ML_EXECUTED_NON_AUTHORITY));
  });

  it('MISSING_MFA_BLOCKED', () => {
    const gate = evaluateActionPolicyActorGate({
      authorized: true,
      mfaVerified: false,
      privilegedActionRequired: true,
    });

    assert.equal(gate.permitted, false);
    assert.ok(gate.reasonCodes.includes(ACTION_POLICY_REASON.MFA_REQUIRED_BLOCKED));
  });

  it('UNAUTHORIZED_ACTOR_BLOCKED', () => {
    const gate = evaluateActionPolicyActorGate({
      authorized: false,
      mfaVerified: true,
      privilegedActionRequired: true,
    });

    assert.equal(gate.permitted, false);
    assert.ok(gate.reasonCodes.includes(ACTION_POLICY_REASON.AUTHORIZATION_BLOCKED));
  });

  it('deterministic replay for identical input', () => {
    const input = {
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      actionMode: 'PRODUCTION' as const,
      infrastructureChanging: true,
    };

    assert.deepEqual(evaluateActionPolicy(input), evaluateActionPolicy(input));
  });
});
