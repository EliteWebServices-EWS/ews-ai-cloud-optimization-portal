import { DECISION_READINESS_POLICY_VERSION } from '../../../decision-readiness/model-version';
import { DECISION_READINESS_REASON } from '../../../decision-readiness/reason-codes';
import { ML_MODEL_CONTRACT_VERSION } from '../../../ml-decision/model-version';
import { ML_DECISION_REASON } from '../../../ml-decision/reason-codes';
import type {
  EvaluateMlDecisionInput,
  MLDecision,
  MlFeatureManifest,
  MlModelAvailability,
} from '../../../ml-decision/types';
import type { Sprint2DecisionReadinessResult } from '../../../decision-readiness/types';
import { ACCOUNT_A, TENANT_A, RESOURCE_ID_A } from '../evidence/identities';

export const FIXED_ML_EVALUATED_AT = '2026-08-19T14:00:00.000Z';

export function buildReadySprint2DecisionReadiness(
  overrides: Partial<Sprint2DecisionReadinessResult> = {},
): Sprint2DecisionReadinessResult {
  return {
    readiness: 'READY',
    reasonCodes: [DECISION_READINESS_REASON.READY],
    policyVersion: DECISION_READINESS_POLICY_VERSION,
    evaluatedAt: FIXED_ML_EVALUATED_AT,
    recommendationCategory: 'BURSTABLE_CREDIT_PRESSURE',
    recommendationId: 'rec-ml-golden',
    recommendedAction: 'RESIZE_INSTANCE',
    findingKey: 'finding-ml-golden',
    persistence: {
      state: 'STABLE',
      persistenceHours: 72,
      reasonCodes: [],
      sourceObservationId: 'obs-1',
      logicalObservationId: 'logical-obs-1',
      ruleId: 'rule-1',
      ruleVersion: '1.0.0',
    },
    maturity: {
      maturity: 'MATURE',
      reasonCodes: [],
      modelVersion: 'evidence-maturity-v1',
      sourceObservationId: 'obs-1',
      sourceLogicalObservationId: 'logical-obs-1',
      stableEpochObservationCount: 3,
      stableEpochHours: 72,
      persistenceHours: 72,
    },
    governance: {
      convergence: {
        state: 'PRESERVED',
        reasonCodes: [],
        ruleVersion: 'governance-v1',
        contextAvailable: true,
      },
    },
    confidence: {
      status: 'HIGH',
      score: 100,
      commercialScore: 100,
      reasonCodes: [],
      formulaVersion: 'commercial-weighted-v1',
      confidenceModelVersion: 'confidence-evidence-aware-v2',
    },
    validation: { valid: true },
    ...overrides,
  };
}

export function buildCompleteMlFeatureManifest(
  overrides: Partial<MlFeatureManifest> = {},
): MlFeatureManifest {
  return {
    featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
    stableEpochObservationCount: 3,
    featuresComplete: true,
    telemetryQualityAdequate: true,
    featureIntegrity: 'VALID',
    ...overrides,
  };
}

export function buildAvailableMlModel(
  overrides: Partial<MlModelAvailability> = {},
): MlModelAvailability {
  return {
    available: true,
    modelId: 'mock-model',
    modelVersion: 'mock-v1',
    compatible: true,
    ...overrides,
  };
}

export function buildUnavailableMlModel(): MlModelAvailability {
  return {
    available: false,
    modelId: 'mock-model',
    modelVersion: 'mock-v1',
    compatible: true,
  };
}

export function buildMlDecisionEvaluateInput(
  overrides: Partial<EvaluateMlDecisionInput> = {},
): EvaluateMlDecisionInput {
  const tenantId = overrides.tenantId ?? TENANT_A;
  const accountId = overrides.accountId ?? ACCOUNT_A;
  return {
    tenantId,
    accountId,
    featureContextScope: overrides.featureContextScope ?? { tenantId, accountId },
    modelContextScope: overrides.modelContextScope ?? { tenantId, accountId },
    correlationId: 'corr-ml-golden',
    recommendationId: 'rec-ml-golden',
    findingKey: 'finding-ml-golden',
    resourceId: RESOURCE_ID_A,
    evaluatedAt: FIXED_ML_EVALUATED_AT,
    evaluationId: 'eval-ml-golden-001',
    decisionReadiness: buildReadySprint2DecisionReadiness(),
    featureManifest: buildCompleteMlFeatureManifest(),
    modelAvailability: buildAvailableMlModel(),
    ...overrides,
  };
}

export function buildMlEligibleExecutedDecision(
  overrides: Partial<MLDecision> = {},
): MLDecision {
  return {
    eligibility: 'ML_ELIGIBLE',
    outcome: 'EXECUTED',
    modelId: 'mock-model',
    modelVersion: 'mock-v1',
    reasonCodes: [ML_DECISION_REASON.ML_ELIGIBLE],
    fallback: 'NONE',
    evaluatedAt: FIXED_ML_EVALUATED_AT,
    eligibilityPolicyVersion: 'ml-eligibility-v1',
    featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
    inferredAt: FIXED_ML_EVALUATED_AT,
    validatedOutput: { modelConfidence: 0.91 },
    evaluationId: 'eval-ml-executed',
    ...overrides,
  };
}

export function buildMlFailedSafeModelUnavailableDecision(): MLDecision {
  return {
    eligibility: 'ML_ELIGIBLE',
    outcome: 'FAILED_SAFE',
    modelId: 'mock-model',
    modelVersion: 'mock-v1',
    reasonCodes: [
      ML_DECISION_REASON.ML_ELIGIBLE,
      ML_DECISION_REASON.ML_FAILED_SAFE_MODEL_UNAVAILABLE,
      ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES,
    ],
    fallback: 'DETERMINISTIC_RULES',
    evaluatedAt: FIXED_ML_EVALUATED_AT,
    eligibilityPolicyVersion: 'ml-eligibility-v1',
    featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
    inferredAt: FIXED_ML_EVALUATED_AT,
    validatedOutput: null,
    evaluationId: 'eval-ml-failed-safe-unavailable',
  };
}

export function buildMlIneligibleInsufficientHistoryInput(): EvaluateMlDecisionInput {
  return buildMlDecisionEvaluateInput({
    featureManifest: buildCompleteMlFeatureManifest({
      stableEpochObservationCount: 1,
    }),
  });
}

export function buildMlIneligibleImmatureInput(): EvaluateMlDecisionInput {
  return buildMlDecisionEvaluateInput({
    decisionReadiness: buildReadySprint2DecisionReadiness({
      maturity: {
        maturity: 'PARTIAL',
        reasonCodes: [],
        modelVersion: 'evidence-maturity-v1',
        sourceObservationId: 'obs-1',
        sourceLogicalObservationId: 'logical-obs-1',
        stableEpochObservationCount: 3,
        stableEpochHours: 24,
        persistenceHours: 24,
      },
    }),
  });
}

export function buildMlSkippedFeatureUnavailableInput(): EvaluateMlDecisionInput {
  return buildMlDecisionEvaluateInput({
    featureManifest: buildCompleteMlFeatureManifest({
      featuresComplete: null,
    }),
  });
}

export function buildMlNoMlGoldenPathInput(
  overrides: Partial<EvaluateMlDecisionInput> = {},
): EvaluateMlDecisionInput {
  return buildMlDecisionEvaluateInput({
    modelAvailability: buildUnavailableMlModel(),
    ...overrides,
  });
}

/** Legacy fixture-only shorthand retained for catalog compatibility. */
export function buildMlIneligibleDecision(): MLDecision {
  return {
    eligibility: 'ML_INELIGIBLE',
    outcome: 'SKIPPED',
    modelId: null,
    modelVersion: null,
    reasonCodes: [ML_DECISION_REASON.ML_INELIGIBLE_INSUFFICIENT_HISTORY],
    fallback: 'DETERMINISTIC_RULES',
    evaluatedAt: FIXED_ML_EVALUATED_AT,
    eligibilityPolicyVersion: 'ml-eligibility-v1',
    evaluationId: 'fixture-ineligible',
  };
}

/** Legacy fixture-only shorthand retained for catalog compatibility. */
export function buildMlEligibleSkippedDecision(): MLDecision {
  return {
    eligibility: 'ML_ELIGIBLE',
    outcome: 'SKIPPED',
    modelId: 'mock-model',
    modelVersion: 'mock-v1',
    reasonCodes: [ML_DECISION_REASON.ML_LOW_MODEL_CONFIDENCE],
    fallback: 'OBSERVE',
    evaluatedAt: FIXED_ML_EVALUATED_AT,
    eligibilityPolicyVersion: 'ml-eligibility-v1',
    evaluationId: 'fixture-eligible-skipped',
  };
}
