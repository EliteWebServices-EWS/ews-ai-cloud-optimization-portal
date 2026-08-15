import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateConfidence,
  CONFIDENCE_FORMULA_VERSION,
  DEFAULT_CONFIDENCE_CONFIG,
} from '../../engines/confidence';
import type { EvidenceValidationResult, StandardizedEvidence } from '../../shared/types';
import {
  buildHealthyEvidence,
  buildHealthyValidation,
  RESOURCE_ID_CONFIDENCE_GOLDEN,
} from '../fixtures/evidence';

const RESOURCE_ID = RESOURCE_ID_CONFIDENCE_GOLDEN;

const evidence: StandardizedEvidence = buildHealthyEvidence();
const validation: EvidenceValidationResult = buildHealthyValidation();

function calculate(input: {
  evidence?: StandardizedEvidence;
  validation?: EvidenceValidationResult;
  resourceId?: string;
}) {
  return calculateConfidence({
    evidence: input.evidence ?? evidence,
    validation: input.validation ?? validation,
    resourceId: input.resourceId ?? RESOURCE_ID,
    config: DEFAULT_CONFIDENCE_CONFIG,
  });
}

function assertCommercialBaseline(
  result: ReturnType<typeof calculate>,
  expectedScore: number,
  expectedStatus: 'HIGH' | 'MEDIUM' | 'LOW'
) {
  assert.equal(result.score, expectedScore);
  assert.equal(result.status, expectedStatus);
  assert.equal(result.formulaVersion, CONFIDENCE_FORMULA_VERSION);
}

describe('confidence scoring baseline', () => {
  it('returns a deterministic HIGH score for complete, stable evidence', () => {
    const result = calculate({});

    assertCommercialBaseline(result, 100, 'HIGH');
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
      ]
    );
  });

  it('remains commercially HIGH when only the current provider recommendation is absent', () => {
    const result = calculate({
      evidence: {
        ...evidence,
        recommendations: [],
      },
    });

    assertCommercialBaseline(result, 88, 'HIGH');
    assert.match(result.reason, /recommendation-persistence/i);

    const persistence = result.factors.find(
      (factor) => factor.name === 'recommendation-persistence'
    );

    assert.deepEqual(persistence, {
      name: 'recommendation-persistence',
      score: 20,
      weight: 15,
      detail: 'No persistent provider recommendation hint available',
    });
  });

  it('remains commercially HIGH with one validation error and explains the reduced completeness factor', () => {
    const result = calculate({
      validation: {
        valid: false,
        errors: ['Pricing evidence requires review'],
        warnings: [],
      },
    });

    assertCommercialBaseline(result, 98, 'HIGH');
    assert.match(result.reason, /evidence-completeness/i);
    assert.match(result.reason, /Pricing evidence requires review/i);

    const completeness = result.factors.find(
      (factor) => factor.name === 'evidence-completeness'
    );

    assert.deepEqual(completeness, {
      name: 'evidence-completeness',
      score: 75,
      weight: 10,
      detail: 'Evidence validation issues: Pricing evidence requires review',
    });
  });

  it('classifies a commercial score of 80 as HIGH at the default threshold', () => {
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

    assertCommercialBaseline(result, 80, 'HIGH');
    assert.match(result.reason, /evidence-completeness/i);
    assert.match(result.reason, /telemetry-continuity/i);
  });

  it('classifies a score of 79 as MEDIUM at the default threshold', () => {
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
    });

    assertCommercialBaseline(result, 79, 'MEDIUM');
  });

  it('classifies a score of 50 as MEDIUM at the default threshold', () => {
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
          utilizationHistory: evidence.metrics.utilizationHistory.slice(0, 4),
        },
        recommendations: [],
      },
      validation: {
        valid: false,
        errors: ['Error one', 'Error two', 'Error three', 'Error four'],
        warnings: [],
      },
    });

    assertCommercialBaseline(result, 50, 'MEDIUM');
  });

  it('classifies a score of 49 as LOW at the default threshold', () => {
    const result = calculate({
      evidence: {
        ...evidence,
        telemetry: {
          ...evidence.telemetry,
          observationWindowDays: 0,
        },
        metrics: {
          ...evidence.metrics,
          datapoints: 0,
          utilizationHistory: evidence.metrics.utilizationHistory.slice(0, 4),
        },
        recommendations: [],
      },
      validation: {
        valid: false,
        errors: ['Error one', 'Error two'],
        warnings: [],
      },
    });

    assertCommercialBaseline(result, 49, 'LOW');
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
    });

    assertCommercialBaseline(result, 93, 'HIGH');
    assert.match(result.reason, /telemetry-continuity/i);

    const telemetry = result.factors.find((factor) => factor.name === 'telemetry-continuity');
    assert.deepEqual(telemetry, {
      name: 'telemetry-continuity',
      score: 29,
      weight: 10,
      detail: '2-day observation window',
    });
  });

  it('documents recommendation present versus absent using current commercial semantics', () => {
    const present = calculate({});
    const absent = calculate({
      evidence: {
        ...evidence,
        recommendations: [],
      },
    });

    assert.equal(
      present.factors.find((factor) => factor.name === 'recommendation-persistence')?.score,
      100
    );
    assert.equal(
      absent.factors.find((factor) => factor.name === 'recommendation-persistence')?.score,
      20
    );
    assertCommercialBaseline(present, 100, 'HIGH');
    assertCommercialBaseline(absent, 88, 'HIGH');
  });

  it('returns equivalent deterministic results for repeated execution', () => {
    const input = {
      evidence: {
        ...evidence,
        recommendations: [],
      },
      validation,
    };

    const first = calculate(input);
    const second = calculate(input);

    assert.deepEqual(
      {
        score: first.score,
        status: first.status,
        reason: first.reason,
        formulaVersion: first.formulaVersion,
        factors: first.factors,
        level: first.level,
      },
      {
        score: second.score,
        status: second.status,
        reason: second.reason,
        formulaVersion: second.formulaVersion,
        factors: second.factors,
        level: second.level,
      }
    );
  });

  it('exposes factor-level explanation for every contributing factor', () => {
    const result = calculate({});

    assert.equal(result.factors.length, 6);
    for (const factor of result.factors) {
      assert.ok(factor.name.length > 0);
      assert.ok(Number.isFinite(factor.score));
      assert.ok(Number.isFinite(factor.weight));
      assert.ok(factor.detail.length > 0);
    }
  });

  it('includes the frozen commercial formula version on every result', () => {
    const result = calculate({});
    assert.equal(result.formulaVersion, 'commercial-weighted-v1');
  });

  it('does not silently omit factor limitations from HIGH reasons', () => {
    const result = calculate({
      evidence: {
        ...evidence,
        recommendations: [],
      },
    });

    assert.equal(result.score, 88);
    assert.equal(result.status, 'HIGH');
    assert.match(result.reason, /factor limitations/i);
    assert.match(result.reason, /recommendation-persistence/i);
  });
});
