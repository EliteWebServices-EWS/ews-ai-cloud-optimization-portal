import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateConfidence,
  CONFIDENCE_FORMULA_VERSION,
  CONFIDENCE_MODEL_VERSION,
  DEFAULT_CONFIDENCE_CONFIG,
  resolveRawCommercialStatus,
} from '../../engines/confidence';
import type { EvidenceValidationResult, StandardizedEvidence } from '../../shared/types';
import {
  buildHealthyEvidence,
  buildHealthyValidation,
  RESOURCE_ID_CONFIDENCE_GOLDEN,
} from '../fixtures/evidence';

const evidence: StandardizedEvidence = buildHealthyEvidence();
const validation: EvidenceValidationResult = buildHealthyValidation();

/**
 * Sprint 1 historical baseline: raw commercial weighted arithmetic and threshold
 * classification from score alone. Sprint 2 v2 adds qualification on final status.
 */
describe('Sprint 1 commercial baseline history', () => {
  function commercial(input: {
    evidence?: StandardizedEvidence;
    validation?: EvidenceValidationResult;
  }) {
    return calculateConfidence({
      evidence: input.evidence ?? evidence,
      validation: input.validation ?? validation,
      resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });
  }

  it('preserves frozen raw score 100 and Sprint 1 raw threshold HIGH', () => {
    const result = commercial({});
    assert.equal(result.score, 100);
    assert.equal(result.commercialScore, 100);
    assert.equal(result.formulaVersion, CONFIDENCE_FORMULA_VERSION);
    assert.equal(resolveRawCommercialStatus(result.score), 'HIGH');
    assert.equal(result.status, 'MEDIUM');
    assert.equal(result.confidenceModelVersion, CONFIDENCE_MODEL_VERSION);
  });

  it('preserves frozen raw score 88 and Sprint 1 raw threshold HIGH', () => {
    const result = commercial({
      evidence: { ...evidence, recommendations: [] },
    });
    assert.equal(result.score, 88);
    assert.equal(resolveRawCommercialStatus(result.score), 'HIGH');
    assert.equal(result.status, 'MEDIUM');
  });

  it('preserves boundary raw score 80 as Sprint 1 raw threshold HIGH', () => {
    const result = commercial({
      evidence: {
        ...evidence,
        telemetry: { ...evidence.telemetry, observationWindowDays: 0 },
      },
      validation: {
        valid: false,
        errors: ['Error one', 'Error two', 'Error three', 'Error four'],
        warnings: [],
      },
    });
    assert.equal(result.score, 80);
    assert.equal(resolveRawCommercialStatus(result.score), 'HIGH');
    assert.equal(result.status, 'MEDIUM');
  });

  it('preserves boundary raw score 79 as Sprint 1 raw threshold MEDIUM', () => {
    const result = commercial({
      evidence: {
        ...evidence,
        telemetry: { ...evidence.telemetry, observationWindowDays: 1 },
        metrics: { ...evidence.metrics, datapoints: 6 },
      },
      validation: {
        valid: false,
        errors: ['Error one', 'Error two', 'Error three', 'Error four'],
        warnings: [],
      },
    });
    assert.equal(result.score, 79);
    assert.equal(resolveRawCommercialStatus(result.score), 'MEDIUM');
    assert.equal(result.status, 'MEDIUM');
  });

  it('preserves boundary raw score 50 as Sprint 1 raw threshold MEDIUM', () => {
    const result = commercial({
      evidence: {
        ...evidence,
        telemetry: { ...evidence.telemetry, observationWindowDays: 0 },
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
    assert.equal(result.score, 50);
    assert.equal(resolveRawCommercialStatus(result.score), 'MEDIUM');
    assert.equal(result.status, 'MEDIUM');
  });

  it('preserves boundary raw score 49 as Sprint 1 raw threshold LOW', () => {
    const result = commercial({
      evidence: {
        ...evidence,
        telemetry: { ...evidence.telemetry, observationWindowDays: 0 },
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
    assert.equal(result.score, 49);
    assert.equal(resolveRawCommercialStatus(result.score), 'LOW');
    assert.equal(result.status, 'LOW');
  });
});
