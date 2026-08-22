import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateActionPolicy,
  ACTION_POLICY_REASON,
} from '../../action-policy';
import { toMlDecisionSummary } from '../../action-policy/ml-decision-summary';
import { MockMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
import { UnavailableMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
import { MlDecisionService } from '../../ml-decision/ml-decision-service';
import { ML_DECISION_REASON } from '../../ml-decision/reason-codes';
import {
  buildReadyReadinessInput,
  FIXED_POLICY_EVALUATED_AT,
} from '../fixtures/action-policy/policy-fixtures';
import {
  buildCompleteMlFeatureManifest,
  buildMlDecisionEvaluateInput,
  buildUnavailableMlModel,
} from '../fixtures/evidence/ml-fixtures';

async function evaluatePolicyFromMl(
  service: MlDecisionService,
  input = buildMlDecisionEvaluateInput(),
) {
  const { decision } = await service.evaluate(input);
  const policy = evaluateActionPolicy({
    evaluatedAt: FIXED_POLICY_EVALUATED_AT,
    decisionReadiness: buildReadyReadinessInput(),
    mlDecisionSummary: toMlDecisionSummary(decision),
    actionMode: 'PRODUCTION',
    infrastructureChanging: true,
  });
  return { decision, policy };
}

describe('Sprint 4 no-ML equivalence', () => {
  it('ML available remains governance- and approval-preserving', async () => {
    const { decision, policy } = await evaluatePolicyFromMl(
      new MlDecisionService(new MockMlInferenceAdapter({ confidence: 0.91 })),
    );
    assert.equal(decision.outcome, 'EXECUTED');
    assert.equal(policy.approval, 'REQUIRED');
    assert.equal(policy.executionEligibility, 'NOT_ELIGIBLE');
    assert.ok(policy.reasonCodes.includes(ACTION_POLICY_REASON.ML_EXECUTED_NON_AUTHORITY));
  });

  it('ML unavailable is a supported production state', async () => {
    const input = buildMlDecisionEvaluateInput({
      modelAvailability: buildUnavailableMlModel(),
    });
    const first = await evaluatePolicyFromMl(
      new MlDecisionService(new UnavailableMlInferenceAdapter()),
      input,
    );
    const second = await evaluatePolicyFromMl(
      new MlDecisionService(new UnavailableMlInferenceAdapter()),
      input,
    );

    assert.equal(first.decision.outcome, 'FAILED_SAFE');
    assert.equal(first.decision.fallback, 'DETERMINISTIC_RULES');
    assert.deepEqual(first.decision.reasonCodes, second.decision.reasonCodes);
    assert.equal(first.policy.approval, second.policy.approval);
    assert.equal(first.policy.approval, 'REQUIRED');
    assert.ok(
      first.decision.reasonCodes.includes(
        ML_DECISION_REASON.ML_FAILED_SAFE_MODEL_UNAVAILABLE,
      ),
    );
  });

  it('required feature missing degrades deterministically and remains explainable', async () => {
    const input = buildMlDecisionEvaluateInput({
      featureManifest: buildCompleteMlFeatureManifest({
        featuresComplete: null,
      }),
    });
    const first = await evaluatePolicyFromMl(
      new MlDecisionService(new MockMlInferenceAdapter()),
      input,
    );
    const second = await evaluatePolicyFromMl(
      new MlDecisionService(new MockMlInferenceAdapter()),
      input,
    );

    assert.equal(first.decision.eligibility, 'ML_INELIGIBLE');
    assert.equal(first.decision.fallback, 'DETERMINISTIC_RULES');
    assert.deepEqual(first.decision.reasonCodes, second.decision.reasonCodes);
    assert.ok(
      first.decision.reasonCodes.includes(
        ML_DECISION_REASON.ML_SKIPPED_FEATURE_UNAVAILABLE,
      ),
    );
    assert.equal(first.policy.approval, 'REQUIRED');
    assert.ok(
      first.policy.reasonCodes.includes(
        ACTION_POLICY_REASON.ML_DETERMINISTIC_FALLBACK_PERMITTED,
      ),
    );
  });

  it('inference failure keeps the deterministic Action Policy path', async () => {
    const first = await evaluatePolicyFromMl(
      new MlDecisionService(new MockMlInferenceAdapter({ throwOnInfer: true })),
    );
    const second = await evaluatePolicyFromMl(
      new MlDecisionService(new MockMlInferenceAdapter({ throwOnInfer: true })),
    );

    assert.equal(first.decision.outcome, 'FAILED_SAFE');
    assert.deepEqual(first.decision.reasonCodes, second.decision.reasonCodes);
    assert.equal(first.policy.approval, 'REQUIRED');
    assert.equal(first.policy.executionEligibility, 'NOT_ELIGIBLE');
    assert.ok(
      first.policy.reasonCodes.includes(
        ACTION_POLICY_REASON.ML_FAILED_SAFE_APPROVAL_UNCHANGED,
      ),
    );
  });
});
