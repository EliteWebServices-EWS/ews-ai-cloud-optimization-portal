import {
  ML_MODEL_CONTRACT_VERSION,
  ML_MIN_EXECUTED_CONFIDENCE,
  ML_MAX_IDENTITY_LENGTH,
  ML_MAX_CONTRIBUTION_JSON_BYTES,
  ML_MAX_CONTRIBUTION_DEPTH,
} from './model-version';
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

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasForbiddenKeys(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): boolean {
  if (depth > ML_MAX_CONTRIBUTION_DEPTH) {
    return true;
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) {
    return true;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenKeys(item, depth + 1, seen));
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      return true;
    }
    if (hasForbiddenKeys((value as Record<string, unknown>)[key], depth + 1, seen)) {
      return true;
    }
  }
  return false;
}

function hasNonFiniteNumbers(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): boolean {
  if (depth > ML_MAX_CONTRIBUTION_DEPTH) {
    return true;
  }
  if (typeof value === 'number') {
    return !Number.isFinite(value);
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) {
    return true;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => hasNonFiniteNumbers(item, depth + 1, seen));
  }
  return Object.values(value as Record<string, unknown>).some((item) =>
    hasNonFiniteNumbers(item, depth + 1, seen),
  );
}

function isBoundedIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= ML_MAX_IDENTITY_LENGTH
  );
}

function invalid(): MlOutputValidationResult {
  return {
    valid: false,
    reasonCode: ML_DECISION_REASON.ML_FAILED_SAFE_INVALID_OUTPUT,
  };
}

export function validateMlInferenceOutput(input: {
  raw: unknown;
  expectedFeatureSchemaVersion: string | null;
  expectedModelVersion: string | null;
  expectedModelId?: string | null;
}): MlOutputValidationResult {
  if (!isPlainObject(input.raw)) {
    return invalid();
  }

  if (hasForbiddenKeys(input.raw)) {
    return invalid();
  }

  const modelId = input.raw.modelId;
  const modelVersion = input.raw.modelVersion;
  const featureSchemaVersion = input.raw.featureSchemaVersion;
  const modelConfidence = input.raw.modelConfidence;

  if (!isBoundedIdentity(modelId) || !isBoundedIdentity(modelVersion)) {
    return invalid();
  }

  if (!isBoundedIdentity(featureSchemaVersion)) {
    return invalid();
  }

  if (featureSchemaVersion !== ML_MODEL_CONTRACT_VERSION) {
    return invalid();
  }

  if (
    input.expectedFeatureSchemaVersion &&
    featureSchemaVersion !== input.expectedFeatureSchemaVersion
  ) {
    return invalid();
  }

  if (input.expectedModelVersion && modelVersion !== input.expectedModelVersion) {
    return invalid();
  }

  if (input.expectedModelId && modelId !== input.expectedModelId) {
    return invalid();
  }

  if (!isFiniteNumber(modelConfidence)) {
    return invalid();
  }

  if (modelConfidence < 0 || modelConfidence > 1) {
    return invalid();
  }

  let contribution: Record<string, unknown> | undefined;
  if (input.raw.contribution !== undefined) {
    if (!isPlainObject(input.raw.contribution)) {
      return invalid();
    }
    if (hasForbiddenKeys(input.raw.contribution) || hasNonFiniteNumbers(input.raw.contribution)) {
      return invalid();
    }
    try {
      const serialized = JSON.stringify(input.raw.contribution);
      if (!serialized || serialized.length > ML_MAX_CONTRIBUTION_JSON_BYTES) {
        return invalid();
      }
      contribution = JSON.parse(serialized) as Record<string, unknown>;
    } catch {
      return invalid();
    }
  }

  return {
    valid: true,
    output:
      contribution === undefined
        ? { modelConfidence }
        : { modelConfidence, contribution },
  };
}

export function isLowModelConfidence(confidence: number): boolean {
  return confidence < ML_MIN_EXECUTED_CONFIDENCE;
}
