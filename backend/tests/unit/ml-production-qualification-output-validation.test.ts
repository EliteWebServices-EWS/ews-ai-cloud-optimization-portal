import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateMlInferenceOutput } from '../../ml-decision/output-validation';
import { ML_MODEL_CONTRACT_VERSION } from '../../ml-decision/model-version';
import { ML_DECISION_REASON } from '../../ml-decision/reason-codes';

const expected = {
  expectedFeatureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
  expectedModelVersion: 'mock-v1',
  expectedModelId: 'mock-model',
};

describe('Sprint 4 ML adversarial output validation', () => {
  it('rejects wrong primitive types', () => {
    assert.equal(validateMlInferenceOutput({ raw: 'EXECUTE', ...expected }).valid, false);
    assert.equal(validateMlInferenceOutput({ raw: 1, ...expected }).valid, false);
    assert.equal(validateMlInferenceOutput({ raw: true, ...expected }).valid, false);
  });

  it('rejects arrays where objects are expected', () => {
    const result = validateMlInferenceOutput({ raw: [], ...expected });
    assert.equal(result.valid, false);
    assert.equal(result.reasonCode, ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT);
  });

  it('rejects objects where scalars are expected', () => {
    const result = validateMlInferenceOutput({
      raw: {
        modelId: 'mock-model',
        modelVersion: 'mock-v1',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: { score: 0.9 },
      },
      ...expected,
    });
    assert.equal(result.valid, false);
  });

  it('ignores extra unknown fields and does not copy them into output', () => {
    const result = validateMlInferenceOutput({
      raw: {
        modelId: 'mock-model',
        modelVersion: 'mock-v1',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: 0.8,
        extraAuthority: 'APPROVED',
        awsAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      },
      ...expected,
    });
    assert.equal(result.valid, true);
    assert.deepEqual(Object.keys(result.output ?? {}), ['modelConfidence']);
  });

  it('rejects prototype-like keys', () => {
    const result = validateMlInferenceOutput({
      raw: {
        modelId: 'mock-model',
        modelVersion: 'mock-v1',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: 0.8,
        __proto__: { polluted: true },
        constructor: { polluted: true },
      },
      ...expected,
    });
    assert.equal(result.valid, false);
  });

  it('rejects oversized identity strings', () => {
    const result = validateMlInferenceOutput({
      raw: {
        modelId: 'm'.repeat(200),
        modelVersion: 'mock-v1',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: 0.8,
      },
      ...expected,
    });
    assert.equal(result.valid, false);
  });

  it('rejects empty identity strings', () => {
    const result = validateMlInferenceOutput({
      raw: {
        modelId: '   ',
        modelVersion: 'mock-v1',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: 0.8,
      },
      ...expected,
    });
    assert.equal(result.valid, false);
  });

  it('rejects negative and huge numeric confidence', () => {
    assert.equal(
      validateMlInferenceOutput({
        raw: {
          modelId: 'mock-model',
          modelVersion: 'mock-v1',
          featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
          modelConfidence: -1,
        },
        ...expected,
      }).valid,
      false,
    );
    assert.equal(
      validateMlInferenceOutput({
        raw: {
          modelId: 'mock-model',
          modelVersion: 'mock-v1',
          featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
          modelConfidence: 9_007_199_254_740_991,
        },
        ...expected,
      }).valid,
      false,
    );
  });

  it('rejects NaN and Infinity confidence', () => {
    assert.equal(
      validateMlInferenceOutput({
        raw: {
          modelId: 'mock-model',
          modelVersion: 'mock-v1',
          featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
          modelConfidence: Number.NaN,
        },
        ...expected,
      }).valid,
      false,
    );
    assert.equal(
      validateMlInferenceOutput({
        raw: {
          modelId: 'mock-model',
          modelVersion: 'mock-v1',
          featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
          modelConfidence: Number.NEGATIVE_INFINITY,
        },
        ...expected,
      }).valid,
      false,
    );
  });

  it('rejects nested malformed metadata', () => {
    const result = validateMlInferenceOutput({
      raw: {
        modelId: 'mock-model',
        modelVersion: 'mock-v1',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: 0.8,
        contribution: { nested: { score: Number.NaN } },
      },
      ...expected,
    });
    assert.equal(result.valid, false);
  });

  it('rejects unexpected model identity and version', () => {
    assert.equal(
      validateMlInferenceOutput({
        raw: {
          modelId: 'other-model',
          modelVersion: 'mock-v1',
          featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
          modelConfidence: 0.8,
        },
        ...expected,
      }).valid,
      false,
    );
    assert.equal(
      validateMlInferenceOutput({
        raw: {
          modelId: 'mock-model',
          modelVersion: 'other-v1',
          featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
          modelConfidence: 0.8,
        },
        ...expected,
      }).valid,
      false,
    );
  });

  it('rejects missing mandatory fields', () => {
    assert.equal(validateMlInferenceOutput({ raw: {}, ...expected }).valid, false);
  });

  it('rejects contribution arrays and oversized contribution JSON', () => {
    assert.equal(
      validateMlInferenceOutput({
        raw: {
          modelId: 'mock-model',
          modelVersion: 'mock-v1',
          featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
          modelConfidence: 0.8,
          contribution: ['not', 'an', 'object'],
        },
        ...expected,
      }).valid,
      false,
    );
    assert.equal(
      validateMlInferenceOutput({
        raw: {
          modelId: 'mock-model',
          modelVersion: 'mock-v1',
          featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
          modelConfidence: 0.8,
          contribution: { blob: 'x'.repeat(5000) },
        },
        ...expected,
      }).valid,
      false,
    );
  });
});
