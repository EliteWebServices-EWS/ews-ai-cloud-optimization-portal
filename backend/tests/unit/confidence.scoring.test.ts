import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateConfidence, DEFAULT_CONFIDENCE_CONFIG } from '../../engines/confidence';
import type { EvidenceValidationResult, StandardizedEvidence } from '../../shared/types';

const RESOURCE_ID = 'i-confidence-001';

const evidence: StandardizedEvidence = {
  telemetry: {
    cpuUtilization: 20,
    memoryUtilization: 40,
    observationWindowDays: 7,
  },
  metrics: {
    cpuUtilization: [20, 20, 20, 20, 20, 20, 20],
    memoryUtilization: [40, 40, 40, 40, 40, 40, 40],
    period: '1h',
    datapoints: 7,
    utilizationHistory: Array.from({ length: 5 }, (_, index) => ({
      timestamp: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      cpuUtilization: 20,
      memoryUtilization: 40,
    })),
  },
  pricing: {
    instanceType: 't3.medium',
    region: 'us-east-1',
    hourlyRate: 0.0416,
    monthlyRate: 30.37,
    currency: 'USD',
  },
  recommendations: [
    {
      resourceId: RESOURCE_ID,
      resourceType: 'EC2',
      action: 'rightsizing',
      target: 't3.small',
      reason: 'Stable low utilization',
    },
  ],
  tags: {
    Environment: 'test',
  },
  instance: {
    instanceId: RESOURCE_ID,
    instanceType: 't3.medium',
    state: 'running',
    region: 'us-east-1',
    launchTime: '2026-01-01T00:00:00.000Z',
  },
  collectedAt: '2026-08-07T00:00:00.000Z',
};

const validation: EvidenceValidationResult = {
  valid: true,
  errors: [],
  warnings: [],
};

describe('confidence scoring baseline', () => {
  it('returns a deterministic HIGH score for complete, stable evidence', () => {
    const result = calculateConfidence({
      evidence,
      validation,
      resourceId: RESOURCE_ID,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });

    assert.equal(result.score, 100);
    assert.equal(result.status, 'HIGH');
    assert.equal(result.level, 'high');
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

  it('remains HIGH when only the current provider recommendation is absent', () => {
    const result = calculateConfidence({
      evidence: {
        ...evidence,
        recommendations: [],
      },
      validation,
      resourceId: RESOURCE_ID,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });

    assert.equal(result.score, 88);
    assert.equal(result.status, 'HIGH');

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

  it('remains HIGH with one validation error when all other factors are strong', () => {
    const result = calculateConfidence({
      evidence,
      validation: {
        valid: false,
        errors: ['Pricing evidence requires review'],
        warnings: [],
      },
      resourceId: RESOURCE_ID,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });

    assert.equal(result.score, 98);
    assert.equal(result.status, 'HIGH');

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
  it('classifies a score of 80 as HIGH at the default threshold', () => {
    const result = calculateConfidence({
      evidence: {
        ...evidence,
        telemetry: {
          ...evidence.telemetry,
          observationWindowDays: 0,
        },
      },
      validation: {
        valid: false,
        errors: [
          'Error one',
          'Error two',
          'Error three',
          'Error four',
        ],
        warnings: [],
      },
      resourceId: RESOURCE_ID,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });

    assert.equal(result.score, 80);
    assert.equal(result.status, 'HIGH');
  });

  it('classifies a score of 79 as MEDIUM at the default threshold', () => {
    const result = calculateConfidence({
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
        errors: [
          'Error one',
          'Error two',
          'Error three',
          'Error four',
        ],
        warnings: [],
      },
      resourceId: RESOURCE_ID,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });

    assert.equal(result.score, 79);
    assert.equal(result.status, 'MEDIUM');
  });
  it('classifies a score of 50 as MEDIUM at the default threshold', () => {
    const result = calculateConfidence({
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
        errors: [
          'Error one',
          'Error two',
          'Error three',
          'Error four',
        ],
        warnings: [],
      },
      resourceId: RESOURCE_ID,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });

    assert.equal(result.score, 50);
    assert.equal(result.status, 'MEDIUM');
  });

  it('classifies a score of 49 as LOW at the default threshold', () => {
    const result = calculateConfidence({
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
        errors: [
          'Error one',
          'Error two',
        ],
        warnings: [],
      },
      resourceId: RESOURCE_ID,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });

    assert.equal(result.score, 49);
    assert.equal(result.status, 'LOW');
  });
});