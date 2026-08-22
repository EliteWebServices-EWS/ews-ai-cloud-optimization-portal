import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateActionPolicy,
  ACTION_POLICY_REASON,
} from '../../action-policy';
import { toMlDecisionSummary } from '../../action-policy/ml-decision-summary';
import { MockMlInferenceAdapter } from '../../ml-decision/adapters/mock-ml-inference-adapter';
import type {
  MlInferenceAdapter,
  MlInferenceAdapterResult,
} from '../../ml-decision/adapters/ml-inference-adapter';
import { MlInferenceTimeoutError } from '../../ml-decision/errors';
import { MlDecisionService } from '../../ml-decision/ml-decision-service';
import { ML_DECISION_REASON } from '../../ml-decision/reason-codes';
import { ML_MODEL_CONTRACT_VERSION } from '../../ml-decision/model-version';
import {
  buildReadyReadinessInput,
  FIXED_POLICY_EVALUATED_AT,
} from '../fixtures/action-policy/policy-fixtures';
import { buildMlDecisionEvaluateInput } from '../fixtures/evidence/ml-fixtures';

class LateSettlingTimeoutAdapter implements MlInferenceAdapter {
  lateResult: MlInferenceAdapterResult | Error | null = null;
  private readonly late: Promise<MlInferenceAdapterResult>;
  private settleSuccess!: (result: MlInferenceAdapterResult) => void;
  private settleFailure!: (error: Error) => void;

  constructor() {
    this.late = new Promise((resolve, reject) => {
      this.settleSuccess = resolve;
      this.settleFailure = reject;
    });
    this.late.catch(() => undefined);
  }

  async infer(): Promise<MlInferenceAdapterResult> {
    throw new MlInferenceTimeoutError();
  }

  settleLateSuccess(result: MlInferenceAdapterResult): void {
    this.lateResult = result;
    this.settleSuccess(result);
  }

  settleLateFailure(error: Error): void {
    this.lateResult = error;
    this.settleFailure(error);
  }
}

describe('Sprint 4 ML inference failure qualification', () => {
  it('timeout degrades to FAILED_SAFE with a stable timeout reason', async () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter({ timeout: true }));
    const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());

    assert.equal(decision.outcome, 'FAILED_SAFE');
    assert.equal(decision.fallback, 'DETERMINISTIC_RULES');
    assert.ok(
      decision.reasonCodes.includes(ML_DECISION_REASON.ML_FAILED_SAFE_INFERENCE_TIMEOUT),
    );
    assert.equal(decision.validatedOutput, null);
  });

  it('late successful inference cannot mutate the returned timeout decision', async () => {
    const adapter = new LateSettlingTimeoutAdapter();
    const service = new MlDecisionService(adapter);
    const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());
    const snapshot = structuredClone(decision);

    adapter.settleLateSuccess({
      status: 'AVAILABLE',
      raw: {
        modelId: 'late-model',
        modelVersion: 'late-v9',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: 0.99,
      },
    });
    await Promise.resolve();

    assert.ok(adapter.lateResult);
    assert.equal(decision.outcome, 'FAILED_SAFE');
    assert.equal(decision.fallback, 'DETERMINISTIC_RULES');
    assert.ok(
      decision.reasonCodes.includes(ML_DECISION_REASON.ML_FAILED_SAFE_INFERENCE_TIMEOUT),
    );
    assert.deepEqual(decision, snapshot);
    assert.equal(decision.validatedOutput, null);
  });

  it('late rejected inference does not surface as an unhandled rejection', async () => {
    const adapter = new LateSettlingTimeoutAdapter();
    const service = new MlDecisionService(adapter);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());
      adapter.settleLateFailure(new Error('late rejected inference'));
      await Promise.resolve();
      await Promise.resolve();

      assert.equal(decision.outcome, 'FAILED_SAFE');
      assert.equal(unhandled.length, 0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('repeated timeout evaluation remains deterministic', async () => {
    const input = buildMlDecisionEvaluateInput();
    const service = new MlDecisionService(new MockMlInferenceAdapter({ timeout: true }));
    const first = await service.evaluate(input);
    const second = await service.evaluate(input);

    assert.deepEqual(first.decision.reasonCodes, second.decision.reasonCodes);
    assert.equal(first.decision.outcome, second.decision.outcome);
    assert.equal(first.decision.fallback, second.decision.fallback);
    assert.equal(first.decision.outcome, 'FAILED_SAFE');
    assert.equal(first.decision.fallback, 'DETERMINISTIC_RULES');
  });

  it('timeout decision cannot produce execution or approval side effects', async () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter({ timeout: true }));
    const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      mlDecisionSummary: toMlDecisionSummary(decision),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });

    assert.equal(policy.approval, 'REQUIRED');
    assert.notEqual(policy.approval, 'APPROVED' as never);
    assert.equal(policy.executionEligibility, 'NOT_ELIGIBLE');
    assert.ok(
      policy.reasonCodes.includes(ACTION_POLICY_REASON.ML_FAILED_SAFE_APPROVAL_UNCHANGED),
    );
  });

  it('exception degrades to FAILED_SAFE with inference-error reason', async () => {
    const service = new MlDecisionService(
      new MockMlInferenceAdapter({ throwOnInfer: true }),
    );
    const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());

    assert.equal(decision.outcome, 'FAILED_SAFE');
    assert.ok(
      decision.reasonCodes.includes(ML_DECISION_REASON.ML_FAILED_SAFE_INFERENCE_ERROR),
    );
  });

  it('malformed response cannot become EXECUTED', async () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter({ raw: ['nope'] }));
    const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());

    assert.equal(decision.outcome, 'FAILED_SAFE');
    assert.ok(
      decision.reasonCodes.includes(ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT),
    );
  });

  it('missing modelId cannot become an actionable decision', async () => {
    const service = new MlDecisionService(
      new MockMlInferenceAdapter({
        raw: {
          modelVersion: 'mock-v1',
          featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
          modelConfidence: 0.91,
        },
      }),
    );
    const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());

    assert.equal(decision.outcome, 'FAILED_SAFE');
    assert.equal(decision.validatedOutput, null);
  });

  it('missing modelVersion cannot become an actionable decision', async () => {
    const service = new MlDecisionService(
      new MockMlInferenceAdapter({
        raw: {
          modelId: 'mock-model',
          featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
          modelConfidence: 0.91,
        },
      }),
    );
    const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());

    assert.equal(decision.outcome, 'FAILED_SAFE');
    assert.ok(
      decision.reasonCodes.includes(ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT),
    );
  });

  it('unexpected output type cannot become EXECUTED', async () => {
    const service = new MlDecisionService(new MockMlInferenceAdapter({ raw: 42 }));
    const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());
    assert.equal(decision.outcome, 'FAILED_SAFE');
  });

  it('confidence below 0 fails safe', async () => {
    const service = new MlDecisionService(
      new MockMlInferenceAdapter({
        raw: {
          modelId: 'mock-model',
          modelVersion: 'mock-v1',
          featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
          modelConfidence: -0.1,
        },
      }),
    );
    const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());
    assert.equal(decision.outcome, 'FAILED_SAFE');
  });

  it('confidence above 1 fails safe', async () => {
    const service = new MlDecisionService(
      new MockMlInferenceAdapter({
        raw: {
          modelId: 'mock-model',
          modelVersion: 'mock-v1',
          featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
          modelConfidence: 1.01,
        },
      }),
    );
    const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());
    assert.equal(decision.outcome, 'FAILED_SAFE');
  });

  it('NaN confidence fails safe', async () => {
    const service = new MlDecisionService(
      new MockMlInferenceAdapter({ confidence: Number.NaN }),
    );
    const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());
    assert.equal(decision.outcome, 'FAILED_SAFE');
  });

  it('Infinity confidence fails safe', async () => {
    const service = new MlDecisionService(
      new MockMlInferenceAdapter({ confidence: Number.POSITIVE_INFINITY }),
    );
    const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());
    assert.equal(decision.outcome, 'FAILED_SAFE');
  });

  it('corrupt metadata fails safe and keeps trusted provenance', async () => {
    const input = buildMlDecisionEvaluateInput();
    const service = new MlDecisionService(
      new MockMlInferenceAdapter({
        raw: {
          modelId: 'attacker-model',
          modelVersion: 'attacker-v9',
          featureSchemaVersion: 'attacker-schema',
          modelConfidence: 0.99,
        },
      }),
    );
    const { decision } = await service.evaluate(input);

    assert.equal(decision.outcome, 'FAILED_SAFE');
    assert.equal(decision.modelId, input.modelAvailability.modelId);
    assert.equal(decision.modelVersion, input.modelAvailability.modelVersion);
    assert.equal(
      decision.featureSchemaVersion,
      input.featureManifest.featureSchemaVersion,
    );
  });

  it('partial contribution with forbidden keys fails safe', async () => {
    const service = new MlDecisionService(
      new MockMlInferenceAdapter({
        raw: {
          modelId: 'mock-model',
          modelVersion: 'mock-v1',
          featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
          modelConfidence: 0.91,
          contribution: { constructor: { admin: true } },
        },
      }),
    );
    const { decision } = await service.evaluate(buildMlDecisionEvaluateInput());
    assert.equal(decision.outcome, 'FAILED_SAFE');
    assert.equal(decision.validatedOutput, null);
  });
});
