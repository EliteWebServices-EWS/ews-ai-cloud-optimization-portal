import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateConfidence,
  CONFIDENCE_FORMULA_VERSION,
  CONFIDENCE_MODEL_VERSION,
  CONFIDENCE_REASON,
  DEFAULT_CONFIDENCE_CONFIG,
} from '../../engines/confidence';
import type { ConfidenceLongitudinalEvidence, EvidenceValidationResult, StandardizedEvidence } from '../../shared/types';
import {
  buildHealthyEvidence,
  buildHealthyValidation,
  RESOURCE_ID_CONFIDENCE_GOLDEN,
} from '../fixtures/evidence';
import {
  buildChangedPersistenceEvidence,
  buildCompleteLongitudinalEvidence,
  buildImmatureMaturityEvidence,
  buildMissingPreviousPersistenceEvidence,
  buildMatureMaturityEvidence,
  buildNewPersistenceEvidence,
  buildPartialMaturityEvidence,
  buildStablePersistenceEvidence,
} from '../fixtures/evidence/confidence-longitudinal-evidence';

const RESOURCE_ID = RESOURCE_ID_CONFIDENCE_GOLDEN;
const evidence: StandardizedEvidence = buildHealthyEvidence();
const validation: EvidenceValidationResult = buildHealthyValidation();

function calculate(input: {
  evidence?: StandardizedEvidence;
  validation?: EvidenceValidationResult;
  resourceId?: string;
  longitudinalEvidence?: ConfidenceLongitudinalEvidence;
}) {
  return calculateConfidence({
    evidence: input.evidence ?? evidence,
    validation: input.validation ?? validation,
    resourceId: input.resourceId ?? RESOURCE_ID,
    config: DEFAULT_CONFIDENCE_CONFIG,
    longitudinalEvidence: input.longitudinalEvidence,
  });
}

function withGovernanceContext(
  longitudinalEvidence: ConfidenceLongitudinalEvidence,
): ConfidenceLongitudinalEvidence {
  return {
    ...longitudinalEvidence,
    governanceConvergence: {
      contextAvailable: true,
      ruleVersion: 'governance-convergence-v1',
    },
  };
}

function withAlignedMaturity(
  persistence: ReturnType<typeof buildStablePersistenceEvidence>,
  maturityBuilder: (overrides?: Partial<import('../../shared/types').ConfidenceMaturityEvidence>) => import('../../shared/types').ConfidenceMaturityEvidence,
  maturityOverrides: Parameters<typeof maturityBuilder>[0] = {},
): ConfidenceLongitudinalEvidence {
  return withGovernanceContext({
    persistence,
    maturity: maturityBuilder({
      sourceObservationId: persistence.sourceObservationId,
      sourceLogicalObservationId: persistence.logicalObservationId,
      sourcePersistenceState: persistence.state,
      persistenceHours: persistence.persistenceHours,
      ...maturityOverrides,
    }),
  });
}

describe('confidence evidence-aware v2 qualification', () => {
  it('returns HIGH for MATURE + STABLE + COMPLETE telemetry with raw score >= 80', () => {
    const result = calculate({
      longitudinalEvidence: withGovernanceContext(buildCompleteLongitudinalEvidence()),
    });

    assert.equal(result.score, 100);
    assert.equal(result.status, 'HIGH');
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.PERSISTENCE_STABLE));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.MATURITY_MATURE));
    assert.ok(!result.reasonCodes.includes(CONFIDENCE_REASON.STATUS_CEILING_APPLIED));
  });

  it('caps final status at MEDIUM for PARTIAL maturity when raw score >= 80', () => {
    const result = calculate({
      longitudinalEvidence: withAlignedMaturity(
        buildStablePersistenceEvidence(),
        buildPartialMaturityEvidence,
      ),
    });

    assert.equal(result.score, 100);
    assert.equal(result.status, 'MEDIUM');
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.MATURITY_PARTIAL));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.TELEMETRY_PARTIAL));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.STATUS_CEILING_APPLIED));
  });

  it('caps final status at LOW for IMMATURE maturity when raw score >= 80', () => {
    const persistence = buildNewPersistenceEvidence();
    const result = calculate({
      longitudinalEvidence: withAlignedMaturity(persistence, buildImmatureMaturityEvidence),
    });

    assert.equal(result.score, 91);
    assert.equal(result.status, 'LOW');
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.MATURITY_IMMATURE));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.PERSISTENCE_NEW));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.STATUS_CEILING_APPLIED));
  });

  it('maps CHANGED persistence to factor score 20 and caps final status at MEDIUM', () => {
    const result = calculate({
      longitudinalEvidence: withAlignedMaturity(
        buildChangedPersistenceEvidence(),
        buildMatureMaturityEvidence,
      ),
    });

    assert.equal(result.factors.find((factor) => factor.name === 'recommendation-persistence')?.score, 20);
    assert.equal(result.score, 88);
    assert.equal(result.status, 'MEDIUM');
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.PERSISTENCE_CHANGED));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.STATUS_CEILING_APPLIED));
  });

  it('maps MISSING_PREVIOUS persistence to factor score 0 and caps final status at LOW', () => {
    const result = calculate({
      longitudinalEvidence: withAlignedMaturity(
        buildMissingPreviousPersistenceEvidence(),
        buildImmatureMaturityEvidence,
        { evidenceCompleteness: 'COMPLETE' },
      ),
    });

    assert.equal(result.factors.find((factor) => factor.name === 'recommendation-persistence')?.score, 0);
    assert.equal(result.score, 85);
    assert.equal(result.status, 'LOW');
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.PERSISTENCE_MISSING_PREVIOUS));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.STATUS_CEILING_APPLIED));
  });

  it('maps NEW persistence to factor score 40 and caps final status at MEDIUM', () => {
    const result = calculate({
      longitudinalEvidence: withAlignedMaturity(buildNewPersistenceEvidence(), buildMatureMaturityEvidence, {
        stableEpochObservationCount: 1,
        stableEpochHours: 0,
      }),
    });

    assert.equal(result.factors.find((factor) => factor.name === 'recommendation-persistence')?.score, 40);
    assert.equal(result.score, 91);
    assert.equal(result.status, 'MEDIUM');
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.PERSISTENCE_NEW));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.STATUS_CEILING_APPLIED));
  });

  it('caps final status at LOW for telemetry NO_DATA when raw score >= 80', () => {
    const result = calculate({
      longitudinalEvidence: withAlignedMaturity(buildStablePersistenceEvidence(), buildMatureMaturityEvidence, {
        evidenceCompleteness: 'NO_DATA',
      }),
    });

    assert.equal(result.score, 100);
    assert.equal(result.status, 'LOW');
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.TELEMETRY_NO_DATA));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.STATUS_CEILING_APPLIED));
  });

  it('caps final status at MEDIUM for telemetry PARTIAL when raw score >= 80', () => {
    const result = calculate({
      longitudinalEvidence: withAlignedMaturity(
        buildStablePersistenceEvidence(),
        buildPartialMaturityEvidence,
      ),
    });

    assert.equal(result.score, 100);
    assert.equal(result.status, 'MEDIUM');
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.TELEMETRY_PARTIAL));
  });

  it('does not penalize NOT_APPLICABLE telemetry completeness', () => {
    const result = calculate({
      longitudinalEvidence: withAlignedMaturity(buildStablePersistenceEvidence(), buildMatureMaturityEvidence, {
        evidenceCompleteness: 'NOT_APPLICABLE',
        telemetryApplicability: 'NOT_APPLICABLE',
        reasonCodes: ['MATURITY_TELEMETRY_NOT_APPLICABLE'],
      }),
    });

    assert.equal(result.score, 100);
    assert.equal(result.status, 'HIGH');
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.TELEMETRY_NOT_APPLICABLE));
    assert.ok(!result.reasonCodes.includes(CONFIDENCE_REASON.STATUS_CEILING_APPLIED));
  });

  it('adds METRICS_PARTIAL reason code without changing approved raw thresholds', () => {
    const result = calculate({
      evidence: {
        ...evidence,
        metrics: {
          ...evidence.metrics,
          datapoints: 6,
        },
      },
      longitudinalEvidence: withGovernanceContext(buildCompleteLongitudinalEvidence()),
    });

    assert.equal(result.score, 97);
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.METRICS_PARTIAL));
  });

  it('adds OBSERVATION_WINDOW_INSUFFICIENT reason code for short windows', () => {
    const result = calculate({
      evidence: {
        ...evidence,
        telemetry: {
          ...evidence.telemetry,
          observationWindowDays: 2,
        },
      },
      longitudinalEvidence: withGovernanceContext(buildCompleteLongitudinalEvidence()),
    });

    assert.equal(result.score, 93);
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.OBSERVATION_WINDOW_INSUFFICIENT));
    assert.equal(result.status, 'HIGH');
  });

  it('records missing governance context without applying a score or status ceiling', () => {
    const persistence = buildStablePersistenceEvidence();
    const result = calculate({
      longitudinalEvidence: {
        persistence,
        maturity: buildMatureMaturityEvidence({
          sourceObservationId: persistence.sourceObservationId,
          sourceLogicalObservationId: persistence.logicalObservationId,
          sourcePersistenceState: persistence.state,
        }),
      },
    });

    assert.equal(result.score, 100);
    assert.equal(result.status, 'HIGH');
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.GOVERNANCE_CONTEXT_MISSING));
    assert.ok(!result.reasonCodes.includes(CONFIDENCE_REASON.STATUS_CEILING_APPLIED));
  });

  it('applies legacy no-context MEDIUM ceiling while preserving raw score >= 80', () => {
    const result = calculate({});

    assert.equal(result.score, 100);
    assert.equal(result.status, 'MEDIUM');
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.PERSISTENCE_HISTORY_ABSENT));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.PERSISTENCE_PROVIDER_HINT_FALLBACK));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.LEGACY_COMMERCIAL_FALLBACK));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.GOVERNANCE_CONTEXT_MISSING));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.STATUS_CEILING_APPLIED));
  });

  it('asserts boundary raw 80 with full context remains HIGH', () => {
    const result = calculate({
      evidence: {
        ...evidence,
        telemetry: {
          ...evidence.telemetry,
          observationWindowDays: 0,
        },
      },
      validation: {
        valid: false,
        errors: ['Error one', 'Error two', 'Error three', 'Error four'],
        warnings: [],
      },
      longitudinalEvidence: withGovernanceContext(buildCompleteLongitudinalEvidence()),
    });

    assert.equal(result.score, 80);
    assert.equal(result.status, 'HIGH');
  });

  it('asserts boundary raw 79 with full context remains MEDIUM', () => {
    const result = calculate({
      evidence: {
        ...evidence,
        telemetry: {
          ...evidence.telemetry,
          observationWindowDays: 1,
        },
        metrics: {
          ...evidence.metrics,
          datapoints: 6,
        },
      },
      validation: {
        valid: false,
        errors: ['Error one', 'Error two', 'Error three', 'Error four'],
        warnings: [],
      },
      longitudinalEvidence: withGovernanceContext(buildCompleteLongitudinalEvidence()),
    });

    assert.equal(result.score, 79);
    assert.equal(result.status, 'MEDIUM');
  });

  it('asserts boundary raw 50 with full context remains MEDIUM', () => {
    const result = calculate({
      evidence: {
        ...evidence,
        telemetry: {
          ...evidence.telemetry,
          observationWindowDays: 0,
        },
        metrics: {
          ...evidence.metrics,
          datapoints: 2,
          utilizationHistory: evidence.metrics.utilizationHistory.slice(0, 1),
        },
        recommendations: [],
      },
      validation: {
        valid: false,
        errors: ['Error one', 'Error two', 'Error three', 'Error four'],
        warnings: [],
      },
      longitudinalEvidence: withGovernanceContext(buildCompleteLongitudinalEvidence()),
    });

    assert.equal(result.score, 50);
    assert.equal(result.status, 'MEDIUM');
  });

  it('asserts boundary raw 49 with full context remains LOW', () => {
    const result = calculate({
      evidence: {
        ...evidence,
        telemetry: {
          ...evidence.telemetry,
          observationWindowDays: 0,
        },
        metrics: {
          ...evidence.metrics,
          datapoints: 1,
          utilizationHistory: evidence.metrics.utilizationHistory.slice(0, 1),
        },
        recommendations: [],
      },
      validation: {
        valid: false,
        errors: ['Error one', 'Error two', 'Error three'],
        warnings: [],
      },
      longitudinalEvidence: withGovernanceContext(buildCompleteLongitudinalEvidence()),
    });

    assert.equal(result.score, 49);
    assert.equal(result.status, 'LOW');
  });

  it('returns deep-equal deterministic results for repeated identical requests', () => {
    const input = {
      longitudinalEvidence: withGovernanceContext(buildCompleteLongitudinalEvidence()),
    };
    const first = calculate(input);
    const second = calculate(input);
    assert.deepEqual(first, second);
  });

  it('uses authoritative persistence instead of provider recommendation presence', () => {
    const persistence = buildStablePersistenceEvidence();
    const result = calculate({
      evidence: {
        ...evidence,
        recommendations: [],
      },
      longitudinalEvidence: withAlignedMaturity(persistence, buildMatureMaturityEvidence),
    });

    assert.equal(
      result.factors.find((factor) => factor.name === 'recommendation-persistence')?.score,
      100,
    );
    assert.equal(result.score, 100);
    assert.ok(!result.reasonCodes.includes(CONFIDENCE_REASON.PERSISTENCE_PROVIDER_HINT_FALLBACK));
  });

  it('emits deterministic reason code ordering', () => {
    const result = calculate({});
    const resorted = [...result.reasonCodes].sort((left, right) => left.localeCompare(right));
    assert.notDeepEqual(result.reasonCodes, resorted);
    assert.deepEqual(
      result.reasonCodes,
      [
        'CONFIDENCE_PERSISTENCE_HISTORY_ABSENT',
        'CONFIDENCE_PERSISTENCE_PROVIDER_HINT_FALLBACK',
        'CONFIDENCE_GOVERNANCE_CONTEXT_MISSING',
        'CONFIDENCE_LEGACY_COMMERCIAL_FALLBACK',
        'CONFIDENCE_STATUS_CEILING_APPLIED',
      ],
    );
    assert.equal(result.formulaVersion, CONFIDENCE_FORMULA_VERSION);
    assert.equal(result.confidenceModelVersion, CONFIDENCE_MODEL_VERSION);
  });
});
