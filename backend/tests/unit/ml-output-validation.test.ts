import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateMlInferenceOutput } from '../../ml-decision/output-validation';
import { ML_MODEL_CONTRACT_VERSION } from '../../ml-decision/model-version';
import { ML_DECISION_REASON } from '../../ml-decision/reason-codes';
import { MockMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
import { MlDecisionService } from '../../ml-decision/ml-decision-service';
import { buildMlDecisionEvaluateInput } from '../fixtures/evidence/ml-fixtures';

describe('ML output validation', () => {
  it('accepts valid structured output', () => {
    const result = validateMlInferenceOutput({
      raw: {
        modelId: 'mock-model',
        modelVersion: 'mock-v1',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: 0.82,
        contribution: { rankingDelta: 0.1 },
      },
      expectedFeatureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
      expectedModelVersion: 'mock-v1',
    });

    assert.equal(result.valid, true);
    assert.equal(result.output?.modelConfidence, 0.82);
  });

  it('rejects missing modelId as FAILED_SAFE invalid output', () => {
    const result = validateMlInferenceOutput({
      raw: {
        modelId: '',
        modelVersion: 'mock-v1',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: 0.82,
      },
      expectedFeatureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
      expectedModelVersion: 'mock-v1',
    });

    assert.equal(result.valid, false);
    assert.equal(result.reasonCode, ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT);
  });

  it('rejects missing modelVersion as FAILED_SAFE invalid output', () => {
    const result = validateMlInferenceOutput({
      raw: {
        modelId: 'mock-model',
        modelVersion: '   ',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: 0.82,
      },
      expectedFeatureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
      expectedModelVersion: 'mock-v1',
    });

    assert.equal(result.valid, false);
    assert.equal(result.reasonCode, ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT);
  });

  it('rejects incompatible featureSchemaVersion as FAILED_SAFE invalid output', () => {
    const result = validateMlInferenceOutput({
      raw: {
        modelId: 'mock-model',
        modelVersion: 'mock-v1',
        featureSchemaVersion: 'wrong-schema',
        modelConfidence: 0.82,
      },
      expectedFeatureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
      expectedModelVersion: 'mock-v1',
    });

    assert.equal(result.valid, false);
    assert.equal(result.reasonCode, ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT);
  });

  it('rejects incompatible modelVersion as FAILED_SAFE invalid output', () => {
    const result = validateMlInferenceOutput({
      raw: {
        modelId: 'mock-model',
        modelVersion: 'other-v1',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: 0.82,
      },
      expectedFeatureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
      expectedModelVersion: 'mock-v1',
    });

    assert.equal(result.valid, false);
    assert.equal(result.reasonCode, ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT);
  });

  it('rejects malformed unserializable contribution as FAILED_SAFE invalid output', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const result = validateMlInferenceOutput({
      raw: {
        modelId: 'mock-model',
        modelVersion: 'mock-v1',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: 0.82,
        contribution: circular,
      },
      expectedFeatureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
      expectedModelVersion: 'mock-v1',
    });

    assert.equal(result.valid, false);
    assert.equal(result.reasonCode, ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT);
  });

  it('rejects NaN confidence as FAILED_SAFE invalid output', () => {
    const result = validateMlInferenceOutput({
      raw: {
        modelId: 'mock-model',
        modelVersion: 'mock-v1',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: Number.NaN,
      },
      expectedFeatureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
      expectedModelVersion: 'mock-v1',
    });

    assert.equal(result.valid, false);
    assert.equal(result.reasonCode, ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT);
  });

  it('rejects Infinity confidence as FAILED_SAFE invalid output', () => {
    const result = validateMlInferenceOutput({
      raw: {
        modelId: 'mock-model',
        modelVersion: 'mock-v1',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: Number.POSITIVE_INFINITY,
      },
      expectedFeatureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
      expectedModelVersion: 'mock-v1',
    });

    assert.equal(result.valid, false);
    assert.equal(result.reasonCode, ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT);
  });

  it('rejects out-of-range confidence', () => {
    const result = validateMlInferenceOutput({
      raw: {
        modelId: 'mock-model',
        modelVersion: 'mock-v1',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: 1.5,
      },
      expectedFeatureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
      expectedModelVersion: 'mock-v1',
    });

    assert.equal(result.valid, false);
    assert.equal(result.reasonCode, ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT);
  });

  it('invalid validation output never becomes EXECUTED in MlDecisionService', async () => {
    class InvalidOutputAdapter extends MockMlInferenceAdapter {
      async infer() {
        return {
          status: 'AVAILABLE' as const,
          raw: {
            modelId: '',
            modelVersion: 'mock-v1',
            featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
            modelConfidence: 0.91,
          },
        };
      }
    }

    const service = new MlDecisionService(new InvalidOutputAdapter());
    const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());

    assert.equal(decision.outcome, 'FAILED_SAFE');
    assert.notEqual(decision.outcome, 'EXECUTED' as never);
    assert.ok(
      decision.reasonCodes.includes(ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT),
    );
  });
});
