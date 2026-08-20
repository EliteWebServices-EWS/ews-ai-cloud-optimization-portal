import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateMlEligibility } from '../../ml-decision/eligibility-policy';
import { ML_MIN_STABLE_EPOCH_OBSERVATIONS } from '../../ml-decision/model-version';
import { ML_DECISION_REASON } from '../../ml-decision/reason-codes';
import {
  buildCompleteMlFeatureManifest,
  buildMlDecisionEvaluateInput,
  buildReadySprint2DecisionReadiness,
} from '../fixtures/evidence/ml-fixtures';

describe('ML eligibility policy', () => {
  it('returns ML_ELIGIBLE when readiness and feature manifest satisfy policy', () => {
    const input = buildMlDecisionEvaluateInput();
    const result = evaluateMlEligibility({
      evaluatedAt: input.evaluatedAt,
      decisionReadiness: input.decisionReadiness,
      featureManifest: input.featureManifest,
      modelAvailability: input.modelAvailability,
    });

    assert.equal(result.eligibility, 'ML_ELIGIBLE');
    assert.ok(result.reasonCodes.includes(ML_DECISION_REASON.ML_ELIGIBLE));
  });

  it('blocks ML when readiness is NOT_READY', () => {
    const input = buildMlDecisionEvaluateInput({
      decisionReadiness: buildReadySprint2DecisionReadiness({ readiness: 'NOT_READY' }),
    });
    const result = evaluateMlEligibility({
      evaluatedAt: input.evaluatedAt,
      decisionReadiness: input.decisionReadiness,
      featureManifest: input.featureManifest,
      modelAvailability: input.modelAvailability,
    });

    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(ML_DECISION_REASON.ML_INELIGIBLE_READINESS_NOT_READY),
    );
  });

  it('blocks ML when observation history is insufficient', () => {
    const input = buildMlDecisionEvaluateInput({
      featureManifest: buildCompleteMlFeatureManifest({
        stableEpochObservationCount: ML_MIN_STABLE_EPOCH_OBSERVATIONS - 1,
      }),
    });
    const result = evaluateMlEligibility({
      evaluatedAt: input.evaluatedAt,
      decisionReadiness: input.decisionReadiness,
      featureManifest: input.featureManifest,
      modelAvailability: input.modelAvailability,
    });

    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(ML_DECISION_REASON.ML_INELIGIBLE_INSUFFICIENT_HISTORY),
    );
  });

  it('does not treat unknown feature completeness as eligible', () => {
    const input = buildMlDecisionEvaluateInput({
      featureManifest: buildCompleteMlFeatureManifest({ featuresComplete: null }),
    });
    const result = evaluateMlEligibility({
      evaluatedAt: input.evaluatedAt,
      decisionReadiness: input.decisionReadiness,
      featureManifest: input.featureManifest,
      modelAvailability: input.modelAvailability,
    });

    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(ML_DECISION_REASON.ML_SKIPPED_FEATURE_UNAVAILABLE),
    );
  });
});
