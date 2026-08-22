import { createHash } from 'node:crypto';

import { MlDecisionScopeError, MlInferenceTimeoutError } from './errors';
import { evaluateMlEligibility } from './eligibility-policy';
import { appendFallbackReason, resolveMlFallback } from './fallback-resolver';
import { ML_ELIGIBILITY_POLICY_VERSION } from './model-version';
import { isLowModelConfidence, validateMlInferenceOutput } from './output-validation';
import { ML_DECISION_REASON } from './reason-codes';
import type { MlInferenceAdapter } from './adapters/ml-inference-adapter';
import type {
  EvaluateMlDecisionInput,
  EvaluateMlDecisionResult,
  MLDecision,
  MlDecisionReasonCode,
  MlTrustedScope,
} from './types';

function assertTrustedScopeMatch(
  requestScope: MlTrustedScope,
  contextScope: MlTrustedScope,
  label: 'feature context' | 'model context',
): void {
  if (requestScope.tenantId !== contextScope.tenantId) {
    throw new MlDecisionScopeError(
      `ML decision ${label} tenant scope does not match request tenantId.`,
    );
  }
  if (requestScope.accountId !== contextScope.accountId) {
    throw new MlDecisionScopeError(
      `ML decision ${label} account scope does not match request accountId.`,
    );
  }
}

function uniqueReasons(codes: MlDecisionReasonCode[]): MlDecisionReasonCode[] {
  return [...new Set(codes)];
}

function buildDecisionBase(input: EvaluateMlDecisionInput): Pick<
  MLDecision,
  | 'evaluatedAt'
  | 'eligibilityPolicyVersion'
  | 'evaluationId'
  | 'featureSchemaVersion'
  | 'modelId'
  | 'modelVersion'
> {
  return {
    evaluatedAt: input.evaluatedAt,
    eligibilityPolicyVersion: ML_ELIGIBILITY_POLICY_VERSION,
    evaluationId: input.evaluationId,
    featureSchemaVersion: input.featureManifest.featureSchemaVersion,
    modelId: input.modelAvailability.modelId,
    modelVersion: input.modelAvailability.modelVersion,
  };
}

export function buildMlEvaluationId(input: {
  tenantId: string;
  accountId: string;
  correlationId: string;
  recommendationId: string;
  evaluatedAt: string;
}): string {
  return createHash('sha256')
    .update(
      `${input.tenantId}|${input.accountId}|${input.correlationId}|${input.recommendationId}|${input.evaluatedAt}|${ML_ELIGIBILITY_POLICY_VERSION}`,
      'utf8',
    )
    .digest('hex')
    .slice(0, 32);
}

export class MlDecisionService {
  constructor(private readonly inferenceAdapter: MlInferenceAdapter) {}

  async evaluate(input: EvaluateMlDecisionInput): Promise<EvaluateMlDecisionResult> {
    const requestScope: MlTrustedScope = {
      tenantId: input.tenantId,
      accountId: input.accountId,
    };
    assertTrustedScopeMatch(requestScope, input.featureContextScope, 'feature context');
    assertTrustedScopeMatch(requestScope, input.modelContextScope, 'model context');

    const eligibility = evaluateMlEligibility({
      evaluatedAt: input.evaluatedAt,
      decisionReadiness: input.decisionReadiness,
      featureManifest: input.featureManifest,
      modelAvailability: input.modelAvailability,
    });

    const base = buildDecisionBase(input);

    if (eligibility.eligibility === 'ML_INELIGIBLE') {
      const reasonCodes = uniqueReasons([...eligibility.reasonCodes]);
      const fallback = resolveMlFallback({
        eligibility: 'ML_INELIGIBLE',
        outcome: 'SKIPPED',
        reasonCodes,
      });

      return {
        decision: {
          ...base,
          eligibility: 'ML_INELIGIBLE',
          outcome: 'SKIPPED',
          reasonCodes: uniqueReasons(appendFallbackReason(fallback, reasonCodes)),
          fallback,
          inferredAt: null,
          validatedOutput: null,
        },
      };
    }

    if (!input.modelAvailability.available) {
      const reasonCodes = uniqueReasons([
        ML_DECISION_REASON.ML_ELIGIBLE,
        ML_DECISION_REASON.ML_FAILED_SAFE_MODEL_UNAVAILABLE,
      ]);
      const fallback = resolveMlFallback({
        eligibility: 'ML_ELIGIBLE',
        outcome: 'FAILED_SAFE',
        reasonCodes,
      });

      return {
        decision: {
          ...base,
          eligibility: 'ML_ELIGIBLE',
          outcome: 'FAILED_SAFE',
          reasonCodes: uniqueReasons(appendFallbackReason(fallback, reasonCodes)),
          fallback,
          inferredAt: input.evaluatedAt,
          validatedOutput: null,
        },
      };
    }

    let adapterResult;
    // Timeout is adapter-signaled (MlInferenceTimeoutError). There is no
    // Promise.race, so there is no losing inference promise to cancel.
    const inferencePromise = this.inferenceAdapter.infer({
      tenantId: input.tenantId,
      accountId: input.accountId,
      correlationId: input.correlationId,
      recommendationId: input.recommendationId,
      findingKey: input.findingKey,
      resourceId: input.resourceId,
      evaluationId: input.evaluationId,
      featureSchemaVersion: input.featureManifest.featureSchemaVersion,
      featureManifest: input.featureManifest,
      modelId: input.modelAvailability.modelId,
      modelVersion: input.modelAvailability.modelVersion,
    });
    try {
      adapterResult = await inferencePromise;
    } catch (error) {
      void inferencePromise.catch(() => undefined);
      const timedOut =
        error instanceof MlInferenceTimeoutError ||
        (error instanceof Error && /timeout/i.test(error.name + error.message));
      const reasonCodes = uniqueReasons([
        ML_DECISION_REASON.ML_ELIGIBLE,
        timedOut
          ? ML_DECISION_REASON.ML_FAILED_SAFE_INFERENCE_TIMEOUT
          : ML_DECISION_REASON.ML_FAILED_SAFE_INFERENCE_ERROR,
      ]);
      const fallback = resolveMlFallback({
        eligibility: 'ML_ELIGIBLE',
        outcome: 'FAILED_SAFE',
        reasonCodes,
      });

      return {
        decision: {
          ...base,
          eligibility: 'ML_ELIGIBLE',
          outcome: 'FAILED_SAFE',
          reasonCodes: uniqueReasons(appendFallbackReason(fallback, reasonCodes)),
          fallback,
          inferredAt: input.evaluatedAt,
          validatedOutput: null,
        },
      };
    }

    if (adapterResult.status === 'UNAVAILABLE' || !adapterResult.raw) {
      const reasonCodes = uniqueReasons([
        ML_DECISION_REASON.ML_ELIGIBLE,
        ML_DECISION_REASON.ML_FAILED_SAFE_MODEL_UNAVAILABLE,
      ]);
      const fallback = resolveMlFallback({
        eligibility: 'ML_ELIGIBLE',
        outcome: 'FAILED_SAFE',
        reasonCodes,
      });

      return {
        decision: {
          ...base,
          eligibility: 'ML_ELIGIBLE',
          outcome: 'FAILED_SAFE',
          reasonCodes: uniqueReasons(appendFallbackReason(fallback, reasonCodes)),
          fallback,
          inferredAt: input.evaluatedAt,
          validatedOutput: null,
        },
      };
    }

    const validated = validateMlInferenceOutput({
      raw: adapterResult.raw,
      expectedFeatureSchemaVersion: input.featureManifest.featureSchemaVersion,
      expectedModelVersion: input.modelAvailability.modelVersion,
      expectedModelId: input.modelAvailability.modelId,
    });

    if (!validated.valid || !validated.output) {
      const reasonCodes = uniqueReasons([
        ML_DECISION_REASON.ML_ELIGIBLE,
        ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT,
      ]);
      const fallback = resolveMlFallback({
        eligibility: 'ML_ELIGIBLE',
        outcome: 'FAILED_SAFE',
        reasonCodes,
      });

      return {
        decision: {
          ...base,
          eligibility: 'ML_ELIGIBLE',
          outcome: 'FAILED_SAFE',
          reasonCodes: uniqueReasons(appendFallbackReason(fallback, reasonCodes)),
          fallback,
          inferredAt: input.evaluatedAt,
          validatedOutput: null,
        },
      };
    }

    if (isLowModelConfidence(validated.output.modelConfidence)) {
      const reasonCodes = uniqueReasons([
        ML_DECISION_REASON.ML_ELIGIBLE,
        ML_DECISION_REASON.ML_LOW_MODEL_CONFIDENCE,
      ]);
      const fallback = resolveMlFallback({
        eligibility: 'ML_ELIGIBLE',
        outcome: 'SKIPPED',
        reasonCodes,
      });

      return {
        decision: {
          ...base,
          eligibility: 'ML_ELIGIBLE',
          outcome: 'SKIPPED',
          reasonCodes: uniqueReasons(appendFallbackReason(fallback, reasonCodes)),
          fallback,
          inferredAt: input.evaluatedAt,
          validatedOutput: validated.output,
        },
      };
    }

    const reasonCodes = uniqueReasons([ML_DECISION_REASON.ML_ELIGIBLE]);
    const fallback = resolveMlFallback({
      eligibility: 'ML_ELIGIBLE',
      outcome: 'EXECUTED',
      reasonCodes,
    });

    return {
      decision: {
        ...base,
        eligibility: 'ML_ELIGIBLE',
        outcome: 'EXECUTED',
        reasonCodes,
        fallback,
        inferredAt: input.evaluatedAt,
        validatedOutput: validated.output,
      },
    };
  }
}
