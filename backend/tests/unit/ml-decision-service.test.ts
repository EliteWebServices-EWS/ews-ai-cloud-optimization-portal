import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MockMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
import { MlDecisionService } from '../../ml-decision/ml-decision-service';
import { ML_DECISION_REASON } from '../../ml-decision/reason-codes';
import {
  buildMlDecisionEvaluateInput,
  buildMlIneligibleImmatureInput,
  buildMlIneligibleInsufficientHistoryInput,
  buildMlNoMlGoldenPathInput,
  buildMlSkippedFeatureUnavailableInput,
} from '../fixtures/evidence/ml-fixtures';

describe('ML decision service golden vectors', () => {
  it('ML_ELIGIBLE_EXECUTED', async () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter({ confidence: 0.91 }));
    const result = await service.evaluate(buildMlDecisionEvaluateInput());

    assert.equal(result.decision.eligibility, 'ML_ELIGIBLE');
    assert.equal(result.decision.outcome, 'EXECUTED');
    assert.equal(result.decision.fallback, 'NONE');
  });

  it('ML_INELIGIBLE_INSUFFICIENT_HISTORY', async () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter());
    const result = await service.evaluate(buildMlIneligibleInsufficientHistoryInput());

    assert.equal(result.decision.eligibility, 'ML_INELIGIBLE');
    assert.equal(result.decision.outcome, 'SKIPPED');
    assert.equal(result.decision.fallback, 'DETERMINISTIC_RULES');
  });

  it('ML_INELIGIBLE_IMMATURE', async () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter());
    const result = await service.evaluate(buildMlIneligibleImmatureInput());

    assert.equal(result.decision.eligibility, 'ML_INELIGIBLE');
    assert.equal(result.decision.fallback, 'OBSERVE');
  });

  it('ML_SKIPPED_FEATURE_UNAVAILABLE', async () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter());
    const result = await service.evaluate(buildMlSkippedFeatureUnavailableInput());

    assert.equal(result.decision.outcome, 'SKIPPED');
    assert.ok(
      result.decision.reasonCodes.includes(ML_DECISION_REASON.ML_SKIPPED_FEATURE_UNAVAILABLE),
    );
  });

  it('ML_FAILED_SAFE_MODEL_UNAVAILABLE', async () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter({ unavailable: true }));
    const result = await service.evaluate(buildMlNoMlGoldenPathInput());

    assert.equal(result.decision.outcome, 'FAILED_SAFE');
    assert.equal(result.decision.fallback, 'DETERMINISTIC_RULES');
    assert.ok(
      result.decision.reasonCodes.includes(ML_DECISION_REASON.ML_FAILED_SAFE_MODEL_UNAVAILABLE),
    );
  });

  it('ML_FAILED_SAFE_INFERENCE_ERROR', async () => {
    const service = new MlDecisionService(
      new MockMlInferenceAdapter({ throwOnInfer: true }),
    );
    const result = await service.evaluate(buildMlDecisionEvaluateInput());

    assert.equal(result.decision.outcome, 'FAILED_SAFE');
    assert.ok(
      result.decision.reasonCodes.includes(ML_DECISION_REASON.ML_FAILED_SAFE_INFERENCE_ERROR),
    );
  });

  it('ML_FAILED_SAFE_CORRUPT_OUTPUT', async () => {
    const service = new MlDecisionService(
      new MockMlInferenceAdapter({ corruptOutput: true }),
    );
    const result = await service.evaluate(buildMlDecisionEvaluateInput());

    assert.equal(result.decision.outcome, 'FAILED_SAFE');
    assert.ok(
      result.decision.reasonCodes.includes(ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT),
    );
  });

  it('ML_LOW_CONFIDENCE_FALLBACK', async () => {
    const service = new MlDecisionService(
      new MockMlInferenceAdapter({ confidence: 0.2 }),
    );
    const result = await service.evaluate(buildMlDecisionEvaluateInput());

    assert.equal(result.decision.outcome, 'SKIPPED');
    assert.equal(result.decision.fallback, 'OBSERVE');
    assert.ok(result.decision.reasonCodes.includes(ML_DECISION_REASON.ML_LOW_MODEL_CONFIDENCE));
  });
});
