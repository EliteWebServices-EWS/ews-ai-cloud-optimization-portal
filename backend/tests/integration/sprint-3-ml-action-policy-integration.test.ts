import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateActionPolicy,
  ACTION_POLICY_REASON,
} from '../../action-policy';
import { toMlDecisionSummary } from '../../action-policy/ml-decision-summary';
import {
  buildReadyReadinessInput,
  FIXED_POLICY_EVALUATED_AT,
} from '../fixtures/action-policy/policy-fixtures';
import { buildMlEligibleExecutedDecision } from '../fixtures/evidence/ml-fixtures';

describe('Sprint 3 ML Action Policy integration', () => {
  it('ML EXECUTED cannot set APPROVED', () => {
    const summary = toMlDecisionSummary(buildMlEligibleExecutedDecision());
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: summary,
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(policy.approval, 'REQUIRED');
    assert.notEqual(policy.approval, 'APPROVED' as never);
    assert.ok(policy.reasonCodes.includes(ACTION_POLICY_REASON.ML_EXECUTED_NON_AUTHORITY));
  });

  it('ML fallback REJECT blocks policy eligibility', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: {
        eligibility: 'ML_INELIGIBLE',
        outcome: 'SKIPPED',
        fallback: 'REJECT',
      },
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(policy.approval, 'BLOCKED');
    assert.equal(policy.executionEligibility, 'NOT_ELIGIBLE');
  });

  it('ML cannot convert NOT_READY into READY', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: {
        ...buildReadyReadinessInput(),
        readiness: 'NOT_READY',
      },
      mlDecisionSummary: toMlDecisionSummary(buildMlEligibleExecutedDecision()),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(policy.decisionReadiness, 'NOT_READY');
    assert.equal(policy.approval, 'BLOCKED');
  });

  it('ML_INELIGIBLE + DETERMINISTIC_RULES preserves approval requirements', () => {
    const policy = evaluateActionPolicy({
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

    assert.equal(policy.approval, 'REQUIRED');
    assert.ok(
      policy.reasonCodes.includes(ACTION_POLICY_REASON.ML_DETERMINISTIC_FALLBACK_PERMITTED),
    );
  });
});
