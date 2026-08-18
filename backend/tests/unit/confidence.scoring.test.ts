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
import { buildCompleteLongitudinalEvidence } from '../fixtures/evidence/confidence-longitudinal-evidence';

const RESOURCE_ID = RESOURCE_ID_CONFIDENCE_GOLDEN;

const evidence: StandardizedEvidence = buildHealthyEvidence();
const validation: EvidenceValidationResult = buildHealthyValidation();
const completeLongitudinal = buildCompleteLongitudinalEvidence();

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

function assertRawCommercialBaseline(
  result: ReturnType<typeof calculate>,
  expectedScore: number,
  expectedRawStatus: 'HIGH' | 'MEDIUM' | 'LOW',
) {
  assert.equal(result.score, expectedScore);
  assert.equal(result.commercialScore, expectedScore);
  assert.equal(result.formulaVersion, CONFIDENCE_FORMULA_VERSION);
  assert.equal(result.confidenceModelVersion, CONFIDENCE_MODEL_VERSION);

  const rawStatus =
    expectedScore >= DEFAULT_CONFIDENCE_CONFIG.scoreHigh
      ? 'HIGH'
      : expectedScore >= DEFAULT_CONFIDENCE_CONFIG.scoreMedium
        ? 'MEDIUM'
        : 'LOW';
  assert.equal(rawStatus, expectedRawStatus);
}

describe('confidence scoring baseline', () => {
  it('returns a deterministic raw commercial score of 100 for complete stable evidence', () => {
    const result = calculate({ longitudinalEvidence: completeLongitudinal });

    assertRawCommercialBaseline(result, 100, 'HIGH');
    assert.equal(result.status, 'HIGH');
    assert.equal(result.level, 'high');
    assert.match(result.reason, /stable workload over observation period/i);
    assert.deepEqual(
      result.factors.map(({ name, score, weight }) => ({ name, score, weight })),
      [
        { name: 'workload-stability', score: 100, weight: 25 },
        { name: 'historical-consistency', score: 100, weight: 20 },
        { name: 'recommendation-persistence', score: 100, weight: 15 },
        { name: 'metrics-quality', score: 100, weight: 20 },
        { name: 'evidence-completeness', score: 100, weight: 10 },
        { name: 'telemetry-continuity', score: 100, weight: 10 },
      ],
    );
  });

  it('applies legacy no-context MEDIUM ceiling while preserving raw commercial score 100', () => {
    const result = calculate({});

    assertRawCommercialBaseline(result, 100, 'HIGH');
    assert.equal(result.status, 'MEDIUM');
    assert.equal(result.level, 'medium');
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.PERSISTENCE_HISTORY_ABSENT));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.LEGACY_COMMERCIAL_FALLBACK));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.STATUS_CEILING_APPLIED));
  });

  it('preserves raw commercial score 88 when provider recommendation is absent under legacy fallback', () => {
    const result = calculate({
      evidence: {
        ...evidence,
        recommendations: [],
      },
    });

    assertRawCommercialBaseline(result, 88, 'HIGH');
    assert.equal(result.status, 'MEDIUM');
    assert.match(result.reason, /recommendation-persistence/i);

    const persistence = result.factors.find(
      (factor) => factor.name === 'recommendation-persistence',
    );

    assert.deepEqual(persistence, {
      name: 'recommendation-persistence',
      score: 20,
      weight: 15,
      detail: 'No persistent provider recommendation hint available',
    });
  });

  it('preserves raw commercial score 98 with one validation error under legacy fallback', () => {
    const result = calculate({
      validation: {
        valid: false,
        errors: ['Pricing evidence requires review'],
        warnings: [],
      },
    });

    assertRawCommercialBaseline(result, 98, 'HIGH');
    assert.equal(result.status, 'MEDIUM');
    assert.match(result.reason, /evidence-completeness/i);
    assert.match(result.reason, /Pricing evidence requires review/i);

    const completeness = result.factors.find((factor) => factor.name === 'evidence-completeness');

    assert.deepEqual(completeness, {
      name: 'evidence-completeness',
      score: 75,
      weight: 10,
      detail: 'Evidence validation issues: Pricing evidence requires review',
    });
  });

  it('classifies raw commercial score 80 as HIGH and qualified MEDIUM without longitudinal context', () => {
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
    });

    assertRawCommercialBaseline(result, 80, 'HIGH');
    assert.equal(result.status, 'MEDIUM');
    assert.match(result.reason, /evidence-completeness/i);
    assert.match(result.reason, /telemetry-continuity/i);
  });

  it('classifies raw and qualified score of 79 as MEDIUM at the default threshold', () => {
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
      longitudinalEvidence: completeLongitudinal,
    });

    assertRawCommercialBaseline(result, 79, 'MEDIUM');
    assert.equal(result.status, 'MEDIUM');
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.METRICS_PARTIAL));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.OBSERVATION_WINDOW_INSUFFICIENT));
  });

  it('classifies raw and qualified score of 50 as MEDIUM at the default threshold', () => {
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
      longitudinalEvidence: completeLongitudinal,
    });

    assertRawCommercialBaseline(result, 50, 'MEDIUM');
    assert.equal(result.status, 'MEDIUM');
  });

  it('classifies raw and qualified score of 49 as LOW at the default threshold', () => {
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
      longitudinalEvidence: completeLongitudinal,
    });

    assertRawCommercialBaseline(result, 49, 'LOW');
    assert.equal(result.status, 'LOW');
  });

  it('documents incomplete telemetry while preserving the commercial calculation', () => {
    const result = calculate({
      evidence: {
        ...evidence,
        telemetry: {
          ...evidence.telemetry,
          observationWindowDays: 2,
        },
      },
      longitudinalEvidence: completeLongitudinal,
    });

    assertRawCommercialBaseline(result, 93, 'HIGH');
    assert.equal(result.status, 'HIGH');
    assert.match(result.reason, /telemetry-continuity/i);
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.OBSERVATION_WINDOW_INSUFFICIENT));
    assert.ok(!result.reasonCodes.includes(CONFIDENCE_REASON.STATUS_CEILING_APPLIED));

    const telemetry = result.factors.find((factor) => factor.name === 'telemetry-continuity');
    assert.deepEqual(telemetry, {
      name: 'telemetry-continuity',
      score: 29,
      weight: 10,
      detail: '2-day observation window',
    });
  });

  it('documents recommendation present versus absent using current commercial semantics', () => {
    const present = calculate({ longitudinalEvidence: completeLongitudinal });
    const absent = calculate({
      evidence: {
        ...evidence,
        recommendations: [],
      },
      longitudinalEvidence: completeLongitudinal,
    });

    assert.equal(
      present.factors.find((factor) => factor.name === 'recommendation-persistence')?.score,
      100,
    );
    assert.equal(
      absent.factors.find((factor) => factor.name === 'recommendation-persistence')?.score,
      100,
    );
    assertRawCommercialBaseline(present, 100, 'HIGH');
    assertRawCommercialBaseline(absent, 100, 'HIGH');
    assert.equal(present.status, 'HIGH');
    assert.equal(absent.status, 'HIGH');
  });

  it('returns equivalent deterministic results for repeated execution', () => {
    const input = {
      evidence: {
        ...evidence,
        recommendations: [],
      },
      validation,
      longitudinalEvidence: completeLongitudinal,
    };

    const first = calculate(input);
    const second = calculate(input);

    assert.deepEqual(first, second);
  });

  it('exposes factor-level explanation for every contributing factor', () => {
    const result = calculate({ longitudinalEvidence: completeLongitudinal });

    assert.equal(result.factors.length, 6);
    for (const factor of result.factors) {
      assert.ok(factor.name.length > 0);
      assert.ok(Number.isFinite(factor.score));
      assert.ok(Number.isFinite(factor.weight));
      assert.ok(factor.detail.length > 0);
    }
  });

  it('includes frozen commercial formula and evidence-aware model versions on every result', () => {
    const result = calculate({ longitudinalEvidence: completeLongitudinal });
    assert.equal(result.formulaVersion, 'commercial-weighted-v1');
    assert.equal(result.confidenceModelVersion, 'confidence-evidence-aware-v2');
  });

  it('does not silently omit factor limitations from HIGH commercial reasons under legacy fallback', () => {
    const result = calculate({
      evidence: {
        ...evidence,
        recommendations: [],
      },
    });

    assert.equal(result.score, 88);
    assert.equal(result.status, 'MEDIUM');
    assert.match(result.reason, /factor limitations/i);
    assert.match(result.reason, /recommendation-persistence/i);
  });
});
