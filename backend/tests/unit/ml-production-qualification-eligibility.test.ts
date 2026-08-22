import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateMlEligibility } from '../../ml-decision/eligibility-policy';
import { ML_DECISION_REASON } from '../../ml-decision/reason-codes';
import { ML_MODEL_CONTRACT_VERSION } from '../../ml-decision/model-version';
import { ML_FEATURE_INTEGRITY_STATES } from '../../ml-decision/types';
import {
  buildAvailableMlModel,
  buildCompleteMlFeatureManifest,
  buildMlDecisionEvaluateInput,
  buildReadySprint2DecisionReadiness,
} from '../fixtures/evidence/ml-fixtures';
import {
  buildMlFeatureIntegrityInput,
  buildMlInsufficientPersistenceInput,
} from '../fixtures/sprint-4-ml/ml-production-qualification-vectors';

function eligibilityOf(input: ReturnType<typeof buildMlDecisionEvaluateInput>) {
  return evaluateMlEligibility({
    evaluatedAt: input.evaluatedAt,
    decisionReadiness: input.decisionReadiness,
    featureManifest: input.featureManifest,
    modelAvailability: input.modelAvailability,
  });
}

describe('Sprint 4 ML eligibility stress matrix', () => {
  it('insufficient observations remain ML_INELIGIBLE with a stable reason code', () => {
    const result = eligibilityOf(
      buildMlDecisionEvaluateInput({
        featureManifest: buildCompleteMlFeatureManifest({
          stableEpochObservationCount: 0,
        }),
      }),
    );
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(ML_DECISION_REASON.ML_INELIGIBLE_INSUFFICIENT_HISTORY),
    );
  });

  it('insufficient persistence cannot silently become eligible', () => {
    const result = eligibilityOf(buildMlInsufficientPersistenceInput());
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(
        ML_DECISION_REASON.ML_INELIGIBLE_INSUFFICIENT_PERSISTENCE,
      ),
    );
  });

  it('immature evidence remains ML_INELIGIBLE', () => {
    const result = eligibilityOf(
      buildMlDecisionEvaluateInput({
        decisionReadiness: buildReadySprint2DecisionReadiness({
          maturity: {
            maturity: 'IMMATURE',
            reasonCodes: [],
            modelVersion: 'evidence-maturity-v1',
            sourceObservationId: 'obs-1',
            sourceLogicalObservationId: 'logical-obs-1',
            stableEpochObservationCount: 3,
            stableEpochHours: 1,
            persistenceHours: 1,
          },
        }),
      }),
    );
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(ML_DECISION_REASON.ML_INELIGIBLE_EVIDENCE_IMMATURE),
    );
  });

  it('partial telemetry cannot silently become eligible', () => {
    const result = eligibilityOf(
      buildMlDecisionEvaluateInput({
        featureManifest: buildCompleteMlFeatureManifest({
          telemetryQualityAdequate: false,
        }),
      }),
    );
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(ML_DECISION_REASON.ML_INELIGIBLE_TELEMETRY_QUALITY),
    );
  });

  it('missing features are never fabricated into eligibility', () => {
    const result = eligibilityOf(buildMlFeatureIntegrityInput('MISSING'));
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(ML_DECISION_REASON.ML_SKIPPED_FEATURE_UNAVAILABLE),
    );
  });

  it('null features are rejected explicitly', () => {
    const result = eligibilityOf(buildMlFeatureIntegrityInput('NULL'));
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(ML_DECISION_REASON.ML_INELIGIBLE_FEATURES_INCOMPLETE),
    );
  });

  it('NaN observation counts are rejected explicitly', () => {
    const result = eligibilityOf(
      buildMlDecisionEvaluateInput({
        featureManifest: buildCompleteMlFeatureManifest({
          stableEpochObservationCount: Number.NaN,
        }),
      }),
    );
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(result.reasonCodes.includes(ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_NAN));
  });

  it('Infinity observation counts are rejected explicitly', () => {
    const result = eligibilityOf(
      buildMlDecisionEvaluateInput({
        featureManifest: buildCompleteMlFeatureManifest({
          stableEpochObservationCount: Number.POSITIVE_INFINITY,
        }),
      }),
    );
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_INFINITY),
    );
  });

  it('malformed features are rejected explicitly', () => {
    const result = eligibilityOf(buildMlFeatureIntegrityInput('MALFORMED'));
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_MALFORMED),
    );
  });

  it('stale features cannot silently become eligible', () => {
    const result = eligibilityOf(buildMlFeatureIntegrityInput('STALE'));
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_STALE),
    );
  });

  it('feature schema mismatch cannot silently proceed', () => {
    const result = eligibilityOf(
      buildMlDecisionEvaluateInput({
        featureManifest: buildCompleteMlFeatureManifest({
          featureSchemaVersion: 'other-schema',
        }),
      }),
    );
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(
        ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_SCHEMA_MISMATCH,
      ),
    );
  });

  it('missing feature schema cannot silently proceed', () => {
    const result = eligibilityOf(
      buildMlDecisionEvaluateInput({
        featureManifest: buildCompleteMlFeatureManifest({
          featureSchemaVersion: null,
        }),
      }),
    );
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(
        ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_SCHEMA_MISMATCH,
      ),
    );
  });

  it('unknown model compatibility cannot silently proceed', () => {
    const result = eligibilityOf(
      buildMlDecisionEvaluateInput({
        modelAvailability: buildAvailableMlModel({ compatible: null }),
      }),
    );
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(
        ML_DECISION_REASON.ML_INELIGIBLE_MODEL_VERSION_INCOMPATIBLE,
      ),
    );
  });

  it('model version mismatch cannot silently proceed', () => {
    const result = eligibilityOf(
      buildMlDecisionEvaluateInput({
        modelAvailability: buildAvailableMlModel({ compatible: false }),
      }),
    );
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(
        ML_DECISION_REASON.ML_INELIGIBLE_MODEL_VERSION_INCOMPATIBLE,
      ),
    );
  });

  it('omitted featureIntegrity cannot silently become ML eligible', () => {
    const typedFields = { ...buildCompleteMlFeatureManifest() };
    delete typedFields.featureIntegrity;
    const result = eligibilityOf(
      buildMlDecisionEvaluateInput({
        featureManifest: typedFields,
      }),
    );
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(
        ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_INTEGRITY_UNASSERTED,
      ),
    );
  });

  it('null featureIntegrity cannot silently become ML eligible', () => {
    const result = eligibilityOf(
      buildMlDecisionEvaluateInput({
        featureManifest: buildCompleteMlFeatureManifest({
          featureIntegrity: null,
        }),
      }),
    );
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(
        ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_INTEGRITY_UNASSERTED,
      ),
    );
  });

  it('VALID is the only positive integrity state', () => {
    for (const integrity of ML_FEATURE_INTEGRITY_STATES) {
      const result = eligibilityOf(
        buildMlDecisionEvaluateInput({
          featureManifest: buildCompleteMlFeatureManifest({
            featureIntegrity: integrity,
          }),
        }),
      );
      if (integrity === 'VALID') {
        assert.equal(result.eligibility, 'ML_ELIGIBLE', integrity);
      } else {
        assert.equal(result.eligibility, 'ML_INELIGIBLE', integrity);
        assert.notEqual(result.reasonCodes.includes(ML_DECISION_REASON.ML_ELIGIBLE), true);
      }
    }
  });

  it('populated typed feature fields cannot bypass omitted integrity', () => {
    const result = eligibilityOf(
      buildMlDecisionEvaluateInput({
        featureManifest: {
          featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
          stableEpochObservationCount: 9,
          featuresComplete: true,
          telemetryQualityAdequate: true,
        },
      }),
    );
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(
        ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_INTEGRITY_UNASSERTED,
      ),
    );
  });

  it('populated typed feature fields cannot bypass STALE integrity', () => {
    const result = eligibilityOf(
      buildMlDecisionEvaluateInput({
        featureManifest: buildCompleteMlFeatureManifest({
          featureIntegrity: 'STALE',
          stableEpochObservationCount: 9,
          featuresComplete: true,
          telemetryQualityAdequate: true,
        }),
      }),
    );
    assert.equal(result.eligibility, 'ML_INELIGIBLE');
    assert.ok(
      result.reasonCodes.includes(ML_DECISION_REASON.ML_INELIGIBLE_FEATURE_STALE),
    );
  });

  it('valid contract schema remains eligible', () => {
    const result = eligibilityOf(
      buildMlDecisionEvaluateInput({
        featureManifest: buildCompleteMlFeatureManifest({
          featureSchemaVersion: ML_MODEL_CONTRACT_VERSION,
          featureIntegrity: 'VALID',
        }),
      }),
    );
    assert.equal(result.eligibility, 'ML_ELIGIBLE');
    assert.ok(result.reasonCodes.includes(ML_DECISION_REASON.ML_ELIGIBLE));
  });
});
