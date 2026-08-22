import {
  ML_ELIGIBILITY_POLICY_VERSION,
  ML_MIN_STABLE_EPOCH_OBSERVATIONS,
  ML_MODEL_CONTRACT_VERSION,
} from './model-version';
import { ML_DECISION_REASON } from './reason-codes';
import type {
  EvaluateMlEligibilityInput,
  MlEligibilityResult,
  MlFeatureManifest,
  MlFeatureIntegrity,
} from './types';
import type { Sprint2DecisionReadinessResult } from '../decision-readiness/types';

function uniqueReasons(codes: MlEligibilityResult['reasonCodes']): MlEligibilityResult['reasonCodes'] {
  return [...new Set(codes)];
}

function integrityReason(
  integrity: MlFeatureIntegrity,
): MlEligibilityResult['reasonCodes'][number] | undefined {
  switch (integrity) {
    case 'MISSING':
      return ML_DECISION_REASON.ML_SKIPPED_FEATURE_UNAVAILABLE;
    case 'NULL':
      return ML_DECISION_REASON.ML_INELIGIBLE_FEATURES_INCOMPLETE;
    case 'NAN':
      return ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_NAN;
    case 'INFINITY':
      return ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_INFINITY;
    case 'MALFORMED':
      return ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_MALFORMED;
    case 'STALE':
      return ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_STALE;
    case 'SCHEMA_MISMATCH':
      return ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_SCHEMA_MISMATCH;
    default:
      return undefined;
  }
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
    featureIntegrity: overrides.featureIntegrity ?? null,
    featureObservedAt: overrides.featureObservedAt ?? null,
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

  if (input.decisionReadiness.persistence.state !== 'STABLE') {
    return {
      eligibility: 'ML_INELIGIBLE',
      reasonCodes: [ML_DECISION_REASON.ML_INELIGIBLE_INSUFFICIENT_PERSISTENCE],
    };
  }

  const declaredIntegrity = input.featureManifest.featureIntegrity;
  if (declaredIntegrity !== 'VALID') {
    if (declaredIntegrity === undefined || declaredIntegrity === null) {
      return {
        eligibility: 'ML_INELIGIBLE',
        reasonCodes: [ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_INTEGRITY_UNASSERTED],
      };
    }
    const reason = integrityReason(declaredIntegrity);
    if (reason) {
      return {
        eligibility: 'ML_INELIGIBLE',
        reasonCodes: [reason],
      };
    }
    return {
      eligibility: 'ML_INELIGIBLE',
      reasonCodes: [ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_INTEGRITY_UNASSERTED],
    };
  }

  const schemaVersion = input.featureManifest.featureSchemaVersion;
  if (
    schemaVersion === null ||
    schemaVersion.trim() === '' ||
    schemaVersion !== ML_MODEL_CONTRACT_VERSION
  ) {
    return {
      eligibility: 'ML_INELIGIBLE',
      reasonCodes: [ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_SCHEMA_MISMATCH],
    };
  }

  const observationCount = input.featureManifest.stableEpochObservationCount;
  if (observationCount === null) {
    return {
      eligibility: 'ML_INELIGIBLE',
      reasonCodes: [ML_DECISION_REASON.ML_INELIGIBLE_INSUFFICIENT_HISTORY],
    };
  }

  if (Number.isNaN(observationCount)) {
    return {
      eligibility: 'ML_INELIGIBLE',
      reasonCodes: [ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_NAN],
    };
  }

  if (!Number.isFinite(observationCount)) {
    return {
      eligibility: 'ML_INELIGIBLE',
      reasonCodes: [ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_INFINITY],
    };
  }

  if (observationCount < ML_MIN_STABLE_EPOCH_OBSERVATIONS) {
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

  if (
    input.modelAvailability.compatible === false ||
    input.modelAvailability.compatible === null
  ) {
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
