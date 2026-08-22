import { ML_MODEL_CONTRACT_VERSION } from '../../../ml-decision/model-version';
import { ML_DECISION_REASON } from '../../../ml-decision/reason-codes';
import type { EvaluateMlDecisionInput, MLDecision } from '../../../ml-decision/types';
import type { MockMlInferenceAdapterOptions } from '../../../ml-decision/adapters/mock-ml-inference-adapter';
import {
  buildAvailableMlModel,
  buildCompleteMlFeatureManifest,
  buildMlDecisionEvaluateInput,
  buildReadySprint2DecisionReadiness,
  buildUnavailableMlModel,
} from '../evidence/ml-fixtures';

export const ML_PRODUCTION_VECTOR_IDS = [
  'ML_PRODUCTION_ELIGIBLE_VALID',
  'ML_INSUFFICIENT_HISTORY',
  'ML_INSUFFICIENT_PERSISTENCE',
  'ML_IMMATURE',
  'ML_FEATURE_MISSING',
  'ML_FEATURE_NULL',
  'ML_FEATURE_NAN',
  'ML_FEATURE_INFINITY',
  'ML_FEATURE_MALFORMED',
  'ML_FEATURE_STALE',
  'ML_FEATURE_SCHEMA_MISMATCH',
  'ML_MODEL_UNAVAILABLE',
  'ML_MODEL_VERSION_INCOMPATIBLE',
  'ML_TIMEOUT',
  'ML_INFERENCE_EXCEPTION',
  'ML_CORRUPT_OUTPUT',
  'ML_MISSING_MODEL_ID',
  'ML_MISSING_MODEL_VERSION',
  'ML_LOW_CONFIDENCE',
  'ML_HIGH_CONFIDENCE_NON_AUTHORITY',
  'ML_NO_ML_DETERMINISTIC_EQUIVALENCE',
  'ML_MALFORMED_METADATA',
] as const;

export type MlProductionVectorId = (typeof ML_PRODUCTION_VECTOR_IDS)[number];

export interface MlProductionVectorExpectation {
  eligibility: MLDecision['eligibility'];
  outcome: MLDecision['outcome'];
  fallback: MLDecision['fallback'];
  reasonCodes: readonly string[];
}

export interface MlProductionQualificationVector {
  id: MlProductionVectorId;
  input: EvaluateMlDecisionInput;
  adapter: MockMlInferenceAdapterOptions;
  expected: MlProductionVectorExpectation;
}

function vector(
  id: MlProductionVectorId,
  input: EvaluateMlDecisionInput,
  expected: MlProductionVectorExpectation,
  adapter: MockMlInferenceAdapterOptions = { confidence: 0.91 },
): MlProductionQualificationVector {
  return { id, input, adapter, expected };
}

export function buildMlInsufficientPersistenceInput(): EvaluateMlDecisionInput {
  return buildMlDecisionEvaluateInput({
    decisionReadiness: buildReadySprint2DecisionReadiness({
      persistence: {
        state: 'NEW',
        persistenceHours: 0,
        reasonCodes: [],
        sourceObservationId: 'obs-1',
        logicalObservationId: 'logical-obs-1',
        ruleId: 'rule-1',
        ruleVersion: '1.0.0',
      },
    }),
  });
}

export function buildMlFeatureIntegrityInput(
  integrity: NonNullable<EvaluateMlDecisionInput['featureManifest']['featureIntegrity']>,
): EvaluateMlDecisionInput {
  return buildMlDecisionEvaluateInput({
    featureManifest: buildCompleteMlFeatureManifest({
      featureIntegrity: integrity,
    }),
  });
}

export const ML_PRODUCTION_QUALIFICATION_VECTORS: readonly MlProductionQualificationVector[] = [
  vector(
    'ML_PRODUCTION_ELIGIBLE_VALID',
    buildMlDecisionEvaluateInput(),
    {
      eligibility: 'ML_ELIGIBLE',
      outcome: 'EXECUTED',
      fallback: 'NONE',
      reasonCodes: [ML_DECISION_REASON.ML_ELIGIBLE],
    },
  ),
  vector(
    'ML_INSUFFICIENT_HISTORY',
    buildMlDecisionEvaluateInput({
      featureManifest: buildCompleteMlFeatureManifest({
        stableEpochObservationCount: 1,
      }),
    }),
    {
      eligibility: 'ML_INELIGIBLE',
      outcome: 'SKIPPED',
      fallback: 'DETERMINISTIC_RULES',
      reasonCodes: [
        ML_DECISION_REASON.ML_INELIGIBLE_INSUFFICIENT_HISTORY,
        ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES,
      ],
    },
  ),
  vector(
    'ML_INSUFFICIENT_PERSISTENCE',
    buildMlInsufficientPersistenceInput(),
    {
      eligibility: 'ML_INELIGIBLE',
      outcome: 'SKIPPED',
      fallback: 'DETERMINISTIC_RULES',
      reasonCodes: [
        ML_DECISION_REASON.ML_INELIGIBLE_INSUFFICIENT_PERSISTENCE,
        ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES,
      ],
    },
  ),
  vector(
    'ML_IMMATURE',
    buildMlDecisionEvaluateInput({
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
    }),
    {
      eligibility: 'ML_INELIGIBLE',
      outcome: 'SKIPPED',
      fallback: 'OBSERVE',
      reasonCodes: [
        ML_DECISION_REASON.ML_INELIGIBLE_EVIDENCE_IMMATURE,
        ML_DECISION_REASON.ML_FALLBACK_OBSERVE,
      ],
    },
  ),
  vector(
    'ML_FEATURE_MISSING',
    buildMlFeatureIntegrityInput('MISSING'),
    {
      eligibility: 'ML_INELIGIBLE',
      outcome: 'SKIPPED',
      fallback: 'DETERMINISTIC_RULES',
      reasonCodes: [
        ML_DECISION_REASON.ML_SKIPPED_FEATURE_UNAVAILABLE,
        ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES,
      ],
    },
  ),
  vector(
    'ML_FEATURE_NULL',
    buildMlFeatureIntegrityInput('NULL'),
    {
      eligibility: 'ML_INELIGIBLE',
      outcome: 'SKIPPED',
      fallback: 'DETERMINISTIC_RULES',
      reasonCodes: [
        ML_DECISION_REASON.ML_INELIGIBLE_FEATURES_INCOMPLETE,
        ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES,
      ],
    },
  ),
  vector(
    'ML_FEATURE_NAN',
    buildMlDecisionEvaluateInput({
      featureManifest: buildCompleteMlFeatureManifest({
        featureIntegrity: 'NAN',
        stableEpochObservationCount: Number.NaN,
      }),
    }),
    {
      eligibility: 'ML_INELIGIBLE',
      outcome: 'SKIPPED',
      fallback: 'REJECT',
      reasonCodes: [
        ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_NAN,
        ML_DECISION_REASON.ML_FALLBACK_REJECT,
      ],
    },
  ),
  vector(
    'ML_FEATURE_INFINITY',
    buildMlDecisionEvaluateInput({
      featureManifest: buildCompleteMlFeatureManifest({
        featureIntegrity: 'INFINITY',
        stableEpochObservationCount: Number.POSITIVE_INFINITY,
      }),
    }),
    {
      eligibility: 'ML_INELIGIBLE',
      outcome: 'SKIPPED',
      fallback: 'REJECT',
      reasonCodes: [
        ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_INFINITY,
        ML_DECISION_REASON.ML_FALLBACK_REJECT,
      ],
    },
  ),
  vector(
    'ML_FEATURE_MALFORMED',
    buildMlFeatureIntegrityInput('MALFORMED'),
    {
      eligibility: 'ML_INELIGIBLE',
      outcome: 'SKIPPED',
      fallback: 'REJECT',
      reasonCodes: [
        ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_MALFORMED,
        ML_DECISION_REASON.ML_FALLBACK_REJECT,
      ],
    },
  ),
  vector(
    'ML_FEATURE_STALE',
    buildMlFeatureIntegrityInput('STALE'),
    {
      eligibility: 'ML_INELIGIBLE',
      outcome: 'SKIPPED',
      fallback: 'DETERMINISTIC_RULES',
      reasonCodes: [
        ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_STALE,
        ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES,
      ],
    },
  ),
  vector(
    'ML_FEATURE_SCHEMA_MISMATCH',
    buildMlDecisionEvaluateInput({
      featureManifest: buildCompleteMlFeatureManifest({
        featureSchemaVersion: 'ml-model-contract-v0',
      }),
    }),
    {
      eligibility: 'ML_INELIGIBLE',
      outcome: 'SKIPPED',
      fallback: 'DETERMINISTIC_RULES',
      reasonCodes: [
        ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_SCHEMA_MISMATCH,
        ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES,
      ],
    },
  ),
  vector(
    'ML_MODEL_UNAVAILABLE',
    buildMlDecisionEvaluateInput({
      modelAvailability: buildUnavailableMlModel(),
    }),
    {
      eligibility: 'ML_ELIGIBLE',
      outcome: 'FAILED_SAFE',
      fallback: 'DETERMINISTIC_RULES',
      reasonCodes: [
        ML_DECISION_REASON.ML_ELIGIBLE,
        ML_DECISION_REASON.ML_FAILED_SAFE_MODEL_UNAVAILABLE,
        ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES,
      ],
    },
    { unavailable: true },
  ),
  vector(
    'ML_MODEL_VERSION_INCOMPATIBLE',
    buildMlDecisionEvaluateInput({
      modelAvailability: buildAvailableMlModel({ compatible: false }),
    }),
    {
      eligibility: 'ML_INELIGIBLE',
      outcome: 'SKIPPED',
      fallback: 'DETERMINISTIC_RULES',
      reasonCodes: [
        ML_DECISION_REASON.ML_INELIGIBLE_MODEL_VERSION_INCOMPATIBLE,
        ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES,
      ],
    },
  ),
  vector(
    'ML_TIMEOUT',
    buildMlDecisionEvaluateInput(),
    {
      eligibility: 'ML_ELIGIBLE',
      outcome: 'FAILED_SAFE',
      fallback: 'DETERMINISTIC_RULES',
      reasonCodes: [
        ML_DECISION_REASON.ML_ELIGIBLE,
        ML_DECISION_REASON.ML_FAILED_SAFE_INFERENCE_TIMEOUT,
        ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES,
      ],
    },
    { timeout: true },
  ),
  vector(
    'ML_INFERENCE_EXCEPTION',
    buildMlDecisionEvaluateInput(),
    {
      eligibility: 'ML_ELIGIBLE',
      outcome: 'FAILED_SAFE',
      fallback: 'DETERMINISTIC_RULES',
      reasonCodes: [
        ML_DECISION_REASON.ML_ELIGIBLE,
        ML_DECISION_REASON.ML_FAILED_SAFE_INFERENCE_ERROR,
        ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES,
      ],
    },
    { throwOnInfer: true },
  ),
  vector(
    'ML_CORRUPT_OUTPUT',
    buildMlDecisionEvaluateInput(),
    {
      eligibility: 'ML_ELIGIBLE',
      outcome: 'FAILED_SAFE',
      fallback: 'DETERMINISTIC_RULES',
      reasonCodes: [
        ML_DECISION_REASON.ML_ELIGIBLE,
        ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT,
        ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES,
      ],
    },
    { corruptOutput: true },
  ),
  vector(
    'ML_MISSING_MODEL_ID',
    buildMlDecisionEvaluateInput(),
    {
      eligibility: 'ML_ELIGIBLE',
      outcome: 'FAILED_SAFE',
      fallback: 'DETERMINISTIC_RULES',
      reasonCodes: [
        ML_DECISION_REASON.ML_ELIGIBLE,
        ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT,
        ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES,
      ],
    },
    {
      raw: {
        modelId: '',
        modelVersion: 'mock-v1',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: 0.91,
      },
    },
  ),
  vector(
    'ML_MISSING_MODEL_VERSION',
    buildMlDecisionEvaluateInput(),
    {
      eligibility: 'ML_ELIGIBLE',
      outcome: 'FAILED_SAFE',
      fallback: 'DETERMINISTIC_RULES',
      reasonCodes: [
        ML_DECISION_REASON.ML_ELIGIBLE,
        ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT,
        ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES,
      ],
    },
    {
      raw: {
        modelId: 'mock-model',
        modelVersion: '',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: 0.91,
      },
    },
  ),
  vector(
    'ML_LOW_CONFIDENCE',
    buildMlDecisionEvaluateInput(),
    {
      eligibility: 'ML_ELIGIBLE',
      outcome: 'SKIPPED',
      fallback: 'OBSERVE',
      reasonCodes: [
        ML_DECISION_REASON.ML_ELIGIBLE,
        ML_DECISION_REASON.ML_LOW_MODEL_CONFIDENCE,
        ML_DECISION_REASON.ML_FALLBACK_OBSERVE,
      ],
    },
    { confidence: 0.2 },
  ),
  vector(
    'ML_HIGH_CONFIDENCE_NON_AUTHORITY',
    buildMlDecisionEvaluateInput(),
    {
      eligibility: 'ML_ELIGIBLE',
      outcome: 'EXECUTED',
      fallback: 'NONE',
      reasonCodes: [ML_DECISION_REASON.ML_ELIGIBLE],
    },
    { confidence: 0.99 },
  ),
  vector(
    'ML_NO_ML_DETERMINISTIC_EQUIVALENCE',
    buildMlDecisionEvaluateInput({
      modelAvailability: buildUnavailableMlModel(),
    }),
    {
      eligibility: 'ML_ELIGIBLE',
      outcome: 'FAILED_SAFE',
      fallback: 'DETERMINISTIC_RULES',
      reasonCodes: [
        ML_DECISION_REASON.ML_ELIGIBLE,
        ML_DECISION_REASON.ML_FAILED_SAFE_MODEL_UNAVAILABLE,
        ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES,
      ],
    },
    { unavailable: true },
  ),
  vector(
    'ML_MALFORMED_METADATA',
    buildMlDecisionEvaluateInput(),
    {
      eligibility: 'ML_ELIGIBLE',
      outcome: 'FAILED_SAFE',
      fallback: 'DETERMINISTIC_RULES',
      reasonCodes: [
        ML_DECISION_REASON.ML_ELIGIBLE,
        ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT,
        ML_DECISION_REASON.ML_FALLBACK_DETERMINISTIC_RULES,
      ],
    },
    {
      raw: {
        modelId: 'mock-model',
        modelVersion: 'mock-v1',
        featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
        modelConfidence: 0.91,
        contribution: { constructor: { polluted: true } },
      },
    },
  ),
];

export function getMlProductionVector(
  id: MlProductionVectorId,
): MlProductionQualificationVector {
  const found = ML_PRODUCTION_QUALIFICATION_VECTORS.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`Unknown ML production qualification vector: ${id}`);
  }
  return found;
}

export function assertVectorDecision(
  decision: MLDecision,
  expected: MlProductionVectorExpectation,
): void {
  if (decision.eligibility !== expected.eligibility) {
    throw new Error(
      `eligibility ${decision.eligibility} !== ${expected.eligibility}`,
    );
  }
  if (decision.outcome !== expected.outcome) {
    throw new Error(`outcome ${decision.outcome} !== ${expected.outcome}`);
  }
  if (decision.fallback !== expected.fallback) {
    throw new Error(`fallback ${decision.fallback} !== ${expected.fallback}`);
  }
  for (const code of expected.reasonCodes) {
    if (!decision.reasonCodes.includes(code as (typeof decision.reasonCodes)[number])) {
      throw new Error(`missing reason code ${code}: ${decision.reasonCodes.join(',')}`);
    }
  }
}
