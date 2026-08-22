import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateActionPolicy,
  ACTION_POLICY_REASON,
} from '../../action-policy';
import { toMlDecisionSummary } from '../../action-policy/ml-decision-summary';
import { qualifyGovernanceSafety } from '../../governance-regression/release-qualification';
import { GOVERNANCE_SAFETY_REASON } from '../../governance-regression/reason-codes';
import { MockMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
import { MlDecisionService } from '../../ml-decision/ml-decision-service';
import {
  buildReadyReadinessInput,
  FIXED_POLICY_EVALUATED_AT,
} from '../fixtures/action-policy/policy-fixtures';
import {
  buildMlDecisionEvaluateInput,
  buildMlEligibleExecutedDecision,
  buildReadySprint2DecisionReadiness,
} from '../fixtures/evidence/ml-fixtures';
import {
  buildMlHighNonAuthorityInput,
  buildMlFailedSafePreservesGovernanceInput,
} from '../fixtures/sprint-4-governance/governance-regression-fixtures';

describe('Sprint 4 ML confidence / calibration interaction', () => {
  it('ML high + governance fail remains blocked by governance qualification', () => {
    const qualification = qualifyGovernanceSafety(buildMlHighNonAuthorityInput());
    assert.equal(qualification.result, 'BLOCKED');
    assert.ok(
      qualification.reasonCodes.includes(
        GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_ML_HIGH_NON_AUTHORITY,
      ) ||
        qualification.reasonCodes.includes(
          GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_CONTRADICTION_DETECTED,
        ),
    );
  });

  it('ML high + NOT_READY cannot set READY or APPROVED', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: {
        ...buildReadyReadinessInput(),
        readiness: 'NOT_READY',
      },
      mlDecisionSummary: toMlDecisionSummary(
        buildMlEligibleExecutedDecision({
          validatedOutput: { modelConfidence: 0.99 },
        }),
      ),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(policy.decisionReadiness, 'NOT_READY');
    assert.equal(policy.approval, 'BLOCKED');
    assert.equal(policy.executionEligibility, 'NOT_ELIGIBLE');
  });

  it('ML high + approval required cannot change approvalRequired', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: toMlDecisionSummary(
        buildMlEligibleExecutedDecision({
          validatedOutput: { modelConfidence: 0.99 },
        }),
      ),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(policy.approval, 'REQUIRED');
    assert.notEqual(policy.approval, 'APPROVED' as never);
    assert.ok(policy.reasonCodes.includes(ACTION_POLICY_REASON.ML_EXECUTED_NON_AUTHORITY));
  });

  it('ML low confidence uses deterministic observe fallback without replacing commercial confidence', async () => {
    const readiness = buildReadySprint2DecisionReadiness();
    const service = new MlDecisionService(new MockMlInferenceAdapter({ confidence: 0.2 }));
    const { decision } = await service.evaluate(
      buildMlDecisionEvaluateInput({ decisionReadiness: readiness }),
    );
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: toMlDecisionSummary(decision),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(decision.outcome, 'SKIPPED');
    assert.equal(decision.fallback, 'OBSERVE');
    assert.equal(readiness.confidence.status, 'HIGH');
    assert.notEqual(decision.validatedOutput?.modelConfidence, readiness.confidence.score);
    assert.equal(policy.approval, 'REQUIRED');
    assert.equal(policy.decisionReadiness, 'READY');
  });

  it('ML failure + HIGH deterministic confidence still requires approval', async () => {
    const readiness = buildReadySprint2DecisionReadiness();
    const service = new MlDecisionService(new MockMlInferenceAdapter({ throwOnInfer: true }));
    const { decision } = await service.evaluate(
      buildMlDecisionEvaluateInput({ decisionReadiness: readiness }),
    );
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: toMlDecisionSummary(decision),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(decision.outcome, 'FAILED_SAFE');
    assert.equal(readiness.confidence.status, 'HIGH');
    assert.equal(policy.approval, 'REQUIRED');
    assert.ok(
      policy.reasonCodes.includes(ACTION_POLICY_REASON.ML_FAILED_SAFE_APPROVAL_UNCHANGED),
    );
  });

  it('ML confidence is not platform confidence, READY, APPROVED, or execution eligibility', async () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter({ confidence: 0.99 }));
    const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: toMlDecisionSummary(decision),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(decision.outcome, 'EXECUTED');
    assert.equal(decision.validatedOutput?.modelConfidence, 0.99);
    assert.notEqual(policy.decisionReadiness, decision.validatedOutput?.modelConfidence as never);
    assert.notEqual(policy.approval, 'APPROVED' as never);
    assert.equal(policy.executionEligibility, 'NOT_ELIGIBLE');
  });

  it('governance regression still treats ML FAILED_SAFE as governance-preserving', () => {
    const qualification = qualifyGovernanceSafety(
      buildMlFailedSafePreservesGovernanceInput(),
    );
    assert.ok(
      qualification.result === 'BLOCKED' || qualification.result === 'INSUFFICIENT_EVIDENCE',
    );
    assert.ok(
      qualification.reasonCodes.includes(
        GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_ML_FAILED_SAFE_PRESERVES_GOVERNANCE,
      ) ||
        qualification.reasonCodes.includes(
          GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_CONTRADICTION_DETECTED,
        ),
    );
  });
});
