import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Ec2PerformanceEvidence } from '../../cloud-intelligence/ec2-cost/ec2-cost-models';
import {
  buildEc2CostPerformanceSummary,
  buildPerformanceSummariesByRegion,
  projectEc2CostPerformanceSummary,
} from '../../cloud-intelligence/ec2-cost/ec2-cost-performance-summary';

function evidence(overrides: Partial<Ec2PerformanceEvidence> = {}): Ec2PerformanceEvidence {
  return {
    tenantId: 't1',
    accountId: '111122223333',
    region: 'us-east-1',
    instanceId: 'i-1',
    observationStart: '2026-08-01T00:00:00.000Z',
    observationEnd: '2026-08-15T00:00:00.000Z',
    periodSeconds: 3600,
    expectedSampleCount: 336,
    actualSampleCount: 320,
    cpuAveragePercent: 12,
    dataCompleteness: 'COMPLETE',
    collectedAt: '2026-08-15T00:00:00.000Z',
    warnings: [],
    ...overrides,
  };
}

describe('buildEc2CostPerformanceSummary', () => {
  it('returns AVAILABLE with the same average for one COMPLETE instance', () => {
    const summary = buildEc2CostPerformanceSummary({
      evidence: [evidence({ cpuAveragePercent: 4.27 })],
      instancesEvaluated: 1,
      runRegionsFailed: [],
    });

    assert.equal(summary.availability, 'AVAILABLE');
    assert.equal(summary.averageCpuUtilizationPercent, 4.27);
    assert.equal(summary.instancesIncludedInAverage, 1);
    assert.equal(summary.instancesWithMetrics, 1);
  });

  it('includes PARTIAL evidence with finite CPU', () => {
    const summary = buildEc2CostPerformanceSummary({
      evidence: [evidence({ dataCompleteness: 'PARTIAL', cpuAveragePercent: 8.5 })],
      instancesEvaluated: 1,
      runRegionsFailed: [],
    });

    assert.equal(summary.availability, 'AVAILABLE');
    assert.equal(summary.averageCpuUtilizationPercent, 8.5);
  });

  it('computes unweighted mean across multiple finite instances', () => {
    const summary = buildEc2CostPerformanceSummary({
      evidence: [
        evidence({ instanceId: 'i-1', cpuAveragePercent: 10 }),
        evidence({ instanceId: 'i-2', cpuAveragePercent: 20 }),
      ],
      instancesEvaluated: 2,
      runRegionsFailed: [],
    });

    assert.equal(summary.availability, 'AVAILABLE');
    assert.equal(summary.averageCpuUtilizationPercent, 15);
  });

  it('preserves genuine zero CPU', () => {
    const summary = buildEc2CostPerformanceSummary({
      evidence: [evidence({ cpuAveragePercent: 0 })],
      instancesEvaluated: 1,
      runRegionsFailed: [],
    });

    assert.equal(summary.averageCpuUtilizationPercent, 0);
    assert.equal(summary.availability, 'AVAILABLE');
  });

  it('excludes NO_DATA evidence', () => {
    const summary = buildEc2CostPerformanceSummary({
      evidence: [evidence({ dataCompleteness: 'NO_DATA', actualSampleCount: 0, cpuAveragePercent: undefined })],
      instancesEvaluated: 1,
      runRegionsFailed: [],
    });

    assert.equal(summary.availability, 'UNAVAILABLE');
    assert.equal(summary.averageCpuUtilizationPercent, undefined);
  });

  it('excludes INSUFFICIENT evidence', () => {
    const summary = buildEc2CostPerformanceSummary({
      evidence: [evidence({ dataCompleteness: 'INSUFFICIENT', cpuAveragePercent: 3 })],
      instancesEvaluated: 1,
      runRegionsFailed: [],
    });

    assert.equal(summary.availability, 'UNAVAILABLE');
    assert.equal(summary.instancesIncludedInAverage, 0);
  });

  it('excludes undefined, NaN, and infinite CPU values', () => {
    const summary = buildEc2CostPerformanceSummary({
      evidence: [
        evidence({ instanceId: 'i-1', cpuAveragePercent: undefined }),
        evidence({ instanceId: 'i-2', cpuAveragePercent: Number.NaN }),
        evidence({ instanceId: 'i-3', cpuAveragePercent: Number.POSITIVE_INFINITY }),
        evidence({ instanceId: 'i-4', cpuAveragePercent: Number.NEGATIVE_INFINITY }),
      ],
      instancesEvaluated: 4,
      runRegionsFailed: [],
    });

    assert.equal(summary.availability, 'UNAVAILABLE');
    assert.equal(summary.averageCpuUtilizationPercent, undefined);
  });

  it('returns PARTIAL when only some evaluated instances are included', () => {
    const summary = buildEc2CostPerformanceSummary({
      evidence: [
        evidence({ instanceId: 'i-1', cpuAveragePercent: 6 }),
        evidence({
          instanceId: 'i-2',
          dataCompleteness: 'NO_DATA',
          actualSampleCount: 0,
          cpuAveragePercent: undefined,
        }),
      ],
      instancesEvaluated: 2,
      runRegionsFailed: [],
    });

    assert.equal(summary.availability, 'PARTIAL');
    assert.equal(summary.averageCpuUtilizationPercent, 6);
    assert.equal(summary.instancesIncludedInAverage, 1);
  });

  it('returns PARTIAL when a run region failed even with usable evidence', () => {
    const summary = buildEc2CostPerformanceSummary({
      evidence: [evidence({ cpuAveragePercent: 5 })],
      instancesEvaluated: 1,
      runRegionsFailed: ['eu-west-1'],
    });

    assert.equal(summary.availability, 'PARTIAL');
    assert.equal(summary.averageCpuUtilizationPercent, 5);
  });

  it('retains observation window bounds across evidence', () => {
    const summary = buildEc2CostPerformanceSummary({
      evidence: [
        evidence({
          instanceId: 'i-1',
          observationStart: '2026-08-01T00:00:00.000Z',
          observationEnd: '2026-08-14T00:00:00.000Z',
        }),
        evidence({
          instanceId: 'i-2',
          observationStart: '2026-08-02T00:00:00.000Z',
          observationEnd: '2026-08-15T00:00:00.000Z',
        }),
      ],
      instancesEvaluated: 2,
      runRegionsFailed: [],
    });

    assert.equal(summary.observationStart, '2026-08-01T00:00:00.000Z');
    assert.equal(summary.observationEnd, '2026-08-15T00:00:00.000Z');
  });
});

describe('buildPerformanceSummariesByRegion', () => {
  it('marks failed regions UNAVAILABLE and keeps succeeded region summaries separate', () => {
    const evidenceByInstance = new Map<string, Ec2PerformanceEvidence>([
      ['us-east-1#i-1', evidence({ region: 'us-east-1', cpuAveragePercent: 4 })],
    ]);

    const summaries = buildPerformanceSummariesByRegion({
      evidenceByInstance,
      regions: ['us-east-1', 'eu-west-1'],
      regionsFailed: ['eu-west-1'],
      instancesEvaluatedByRegion: new Map([
        ['us-east-1', 1],
        ['eu-west-1', 2],
      ]),
    });

    assert.equal(summaries['us-east-1']?.availability, 'PARTIAL');
    assert.equal(summaries['us-east-1']?.averageCpuUtilizationPercent, 4);
    assert.equal(summaries['eu-west-1']?.availability, 'UNAVAILABLE');
  });
});

describe('projectEc2CostPerformanceSummary', () => {
  it('projects API provenance without duplicating it in the stored summary', () => {
    const projected = projectEc2CostPerformanceSummary(
      {
        runId: 'run-1',
        completedAt: '2026-08-15T12:00:00.000Z',
        regions: ['us-east-1'],
        performanceSummariesByRegion: {
          'us-east-1': {
            availability: 'AVAILABLE',
            averageCpuUtilizationPercent: 4.27,
            instancesEvaluated: 1,
            instancesWithMetrics: 1,
            instancesIncludedInAverage: 1,
          },
        },
      },
      'us-east-1',
    );

    assert.equal(projected?.analysisRunId, 'run-1');
    assert.equal(projected?.analyzedAt, '2026-08-15T12:00:00.000Z');
    assert.equal(projected?.averageCpuUtilizationPercent, 4.27);
  });

  it('returns UNAVAILABLE projection for older runs without stored summaries', () => {
    const projected = projectEc2CostPerformanceSummary(
      {
        runId: 'run-old',
        completedAt: '2026-01-01T00:00:00.000Z',
        regions: ['us-east-1'],
      },
      'us-east-1',
    );

    assert.equal(projected?.availability, 'UNAVAILABLE');
    assert.equal(projected?.averageCpuUtilizationPercent, undefined);
  });
});
