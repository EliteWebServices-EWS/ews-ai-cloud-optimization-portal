import { ML_MODEL_CONTRACT_VERSION, ML_MIN_EXECUTED_CONFIDENCE } from './model-version';
import { ML_DECISION_REASON } from './reason-codes';
import type { MlValidatedOutput } from './types';

export interface RawMlInferenceResult {
  modelId: string;
  modelVersion: string;
  featureSchemaVersion: string;
  modelConfidence: number;
  contribution?: Record<string, unknown>;
}

export interface MlOutputValidationResult {
  valid: boolean;
  reasonCode?: typeof ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT;
  output?: MlValidatedOutput;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateMlInferenceOutput(input: {
  raw: RawMlInferenceResult;
  expectedFeatureSchemaVersion: string | null;
  expectedModelVersion: string | null;
}): MlOutputValidationResult {
  if (!input.raw.modelId?.trim() || !input.raw.modelVersion?.trim()) {
    return {
      valid: false,
      reasonCode: ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT,
    };
  }

  if (input.raw.featureSchemaVersion !== ML_MODEL_CONTRACT_VERSION) {
    return {
      valid: false,
      reasonCode: ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT,
    };
  }

  if (
    input.expectedFeatureSchemaVersion &&
    input.raw.featureSchemaVersion !== input.expectedFeatureSchemaVersion
  ) {
    return {
      valid: false,
      reasonCode: ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT,
    };
  }

  if (
    input.expectedModelVersion &&
    input.raw.modelVersion !== input.expectedModelVersion
  ) {
    return {
      valid: false,
      reasonCode: ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT,
    };
  }

  if (!isFiniteNumber(input.raw.modelConfidence)) {
    return {
      valid: false,
      reasonCode: ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT,
    };
  }

  if (input.raw.modelConfidence < 0 || input.raw.modelConfidence > 1) {
    return {
      valid: false,
      reasonCode: ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT,
    };
  }

  if (input.raw.contribution !== undefined) {
    try {
      JSON.stringify(input.raw.contribution);
    } catch {
      return {
        valid: false,
        reasonCode: ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT,
      };
    }
  }

  return {
    valid: true,
    output: {
      modelConfidence: input.raw.modelConfidence,
      contribution: input.raw.contribution,
    },
  };
}

export function isLowModelConfidence(confidence: number): boolean {
  return confidence < ML_MIN_EXECUTED_CONFIDENCE;
}
