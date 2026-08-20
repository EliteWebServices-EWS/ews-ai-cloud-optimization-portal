import {
  ML_ELIGIBILITY_POLICY_VERSION,
  ML_MIN_STABLE_EPOCH_OBSERVATIONS,
} from './model-version';
import { ML_DECISION_REASON } from './reason-codes';
import type {
  EvaluateMlEligibilityInput,
  MlEligibilityResult,
  MlFeatureManifest,
} from './types';
import type { Sprint2DecisionReadinessResult } from '../decision-readiness/types';

function uniqueReasons(codes: MlEligibilityResult['reasonCodes']): MlEligibilityResult['reasonCodes'] {
  return [...new Set(codes)];
}

export function buildMlFeatureManifestFromReadiness(
  readiness: Sprint2DecisionReadinessResult,
  overrides: Partial<MlFeatureManifest> = {},
): MlFeatureManifest {
  const maturity = readiness.maturity;

  return {
    featureSchemaVersion: overrides.featureSchemaVersion ?? null,
    stableEpochObservationCount:
      overrides.stableEpochObservationCount ??
      maturity?.stableEpochObservationCount ??
      null,
    featuresComplete: overrides.featuresComplete ?? null,
    telemetryQualityAdequate: overrides.telemetryQualityAdequate ?? null,
  };
}

/**
 * Deterministic ML eligibility — consumes structured upstream evidence only.
 * Does not invoke inference and does not fabricate missing inputs.
 */
export function evaluateMlEligibility(
  input: EvaluateMlEligibilityInput,
): MlEligibilityResult {
  const reasonCodes: MlEligibilityResult['reasonCodes'] = [];

  if (input.decisionReadiness.readiness !== 'READY') {
    return {
      eligibility: 'ML_INELIGIBLE',
      reasonCodes: [ML_DECISION_REASON.ML_INELIGIBLE_READINESS_NOT_READY],
    };
  }

  if (!input.decisionReadiness.validation.valid) {
    return {
      eligibility: 'ML_INELIGIBLE',
      reasonCodes: [ML_DECISION_REASON.ML_INELIGIBLE_EVIDENCE_INVALID],
    };
  }

  if (input.decisionReadiness.maturity?.maturity !== 'MATURE') {
    return {
      eligibility: 'ML_INELIGIBLE',
      reasonCodes: [ML_DECISION_REASON.ML_INELIGIBLE_EVIDENCE_IMMATURE],
    };
  }

  const observationCount = input.featureManifest.stableEpochObservationCount;
  if (
    observationCount === null ||
    observationCount < ML_MIN_STABLE_EPOCH_OBSERVATIONS
  ) {
    return {
      eligibility: 'ML_INELIGIBLE',
      reasonCodes: [ML_DECISION_REASON.ML_INELIGIBLE_INSUFFICIENT_HISTORY],
    };
  }

  if (input.featureManifest.featuresComplete === false) {
    return {
      eligibility: 'ML_INELIGIBLE',
      reasonCodes: [ML_DECISION_REASON.ML_INELIGIBLE_FEATURES_INCOMPLETE],
    };
  }

  if (input.featureManifest.featuresComplete === null) {
    return {
      eligibility: 'ML_INELIGIBLE',
      reasonCodes: [ML_DECISION_REASON.ML_SKIPPED_FEATURE_UNAVAILABLE],
    };
  }

  if (input.featureManifest.telemetryQualityAdequate === false) {
    return {
      eligibility: 'ML_INELIGIBLE',
      reasonCodes: [ML_DECISION_REASON.ML_INELIGIBLE_TELEMETRY_QUALITY],
    };
  }

  if (input.featureManifest.telemetryQualityAdequate === null) {
    return {
      eligibility: 'ML_INELIGIBLE',
      reasonCodes: [ML_DECISION_REASON.ML_INELIGIBLE_TELEMETRY_QUALITY],
    };
  }

  if (input.modelAvailability.compatible === false) {
    return {
      eligibility: 'ML_INELIGIBLE',
      reasonCodes: [ML_DECISION_REASON.ML_INELIGIBLE_MODEL_VERSION_INCOMPATIBLE],
    };
  }

  reasonCodes.push(ML_DECISION_REASON.ML_ELIGIBLE);

  return {
    eligibility: 'ML_ELIGIBLE',
    reasonCodes: uniqueReasons(reasonCodes),
  };
}

export function getMlEligibilityPolicyVersion(): string {
  return ML_ELIGIBILITY_POLICY_VERSION;
}
