import type {
  Ec2CostPerformanceSummary,
  Ec2PerformanceEvidence,
} from './ec2-cost-models';

export interface BuildEc2CostPerformanceSummaryInput {
  evidence: Ec2PerformanceEvidence[];
  instancesEvaluated: number;
  /** Any region failures for the overall cost analysis run. */
  runRegionsFailed: string[];
}

export interface BuildPerformanceSummariesByRegionInput {
  evidenceByInstance: Map<string, Ec2PerformanceEvidence>;
  regions: string[];
  regionsFailed: string[];
  instancesEvaluatedByRegion: Map<string, number>;
}

export interface Ec2CostPerformanceSummaryProjection extends Ec2CostPerformanceSummary {
  analysisRunId?: string;
  analyzedAt?: string;
}

const INcludableCompleteness = new Set<Ec2PerformanceEvidence['dataCompleteness']>([
  'COMPLETE',
  'PARTIAL',
]);

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

export function evidenceHasMetrics(evidence: Ec2PerformanceEvidence): boolean {
  return evidence.actualSampleCount > 0 && evidence.dataCompleteness !== 'NO_DATA';
}

export function evidenceIncludedInAverage(evidence: Ec2PerformanceEvidence): boolean {
  return (
    INcludableCompleteness.has(evidence.dataCompleteness) &&
    typeof evidence.cpuAveragePercent === 'number' &&
    Number.isFinite(evidence.cpuAveragePercent)
  );
}

function deriveObservationWindow(
  evidence: Ec2PerformanceEvidence[],
): Pick<Ec2CostPerformanceSummary, 'observationStart' | 'observationEnd'> {
  if (evidence.length === 0) {
    return {};
  }

  let observationStart = evidence[0]!.observationStart;
  let observationEnd = evidence[0]!.observationEnd;

  for (const item of evidence.slice(1)) {
    if (item.observationStart < observationStart) {
      observationStart = item.observationStart;
    }
    if (item.observationEnd > observationEnd) {
      observationEnd = item.observationEnd;
    }
  }

  return { observationStart, observationEnd };
}

export function buildEc2CostPerformanceSummary(
  input: BuildEc2CostPerformanceSummaryInput,
): Ec2CostPerformanceSummary {
  const instancesWithMetrics = input.evidence.filter(evidenceHasMetrics).length;
  const included = input.evidence.filter(evidenceIncludedInAverage);
  const instancesIncludedInAverage = included.length;
  const observationWindow = deriveObservationWindow(input.evidence);

  if (instancesIncludedInAverage === 0) {
    return {
      availability: 'UNAVAILABLE',
      instancesEvaluated: input.instancesEvaluated,
      instancesWithMetrics,
      instancesIncludedInAverage: 0,
      ...observationWindow,
    };
  }

  const averageCpuUtilizationPercent = roundPercent(
    included.reduce((sum, item) => sum + item.cpuAveragePercent!, 0) /
      instancesIncludedInAverage,
  );

  const fullFleetCoverage =
    instancesIncludedInAverage === input.instancesEvaluated && input.instancesEvaluated > 0;
  const availability =
    input.runRegionsFailed.length === 0 && fullFleetCoverage ? 'AVAILABLE' : 'PARTIAL';

  return {
    availability,
    averageCpuUtilizationPercent,
    instancesEvaluated: input.instancesEvaluated,
    instancesWithMetrics,
    instancesIncludedInAverage,
    ...observationWindow,
  };
}

export function buildPerformanceSummariesByRegion(
  input: BuildPerformanceSummariesByRegionInput,
): Record<string, Ec2CostPerformanceSummary> {
  const summaries: Record<string, Ec2CostPerformanceSummary> = {};

  for (const region of input.regions) {
    const instancesEvaluated = input.instancesEvaluatedByRegion.get(region) ?? 0;
    if (input.regionsFailed.includes(region)) {
      summaries[region] = {
        availability: 'UNAVAILABLE',
        instancesEvaluated,
        instancesWithMetrics: 0,
        instancesIncludedInAverage: 0,
      };
      continue;
    }

    const evidence = [...input.evidenceByInstance.values()].filter(
      (item) => item.region === region,
    );

    summaries[region] = buildEc2CostPerformanceSummary({
      evidence,
      instancesEvaluated,
      runRegionsFailed: input.regionsFailed,
    });
  }

  return summaries;
}

export function projectEc2CostPerformanceSummary(
  run: {
    runId: string;
    completedAt?: string;
    regions: string[];
    performanceSummariesByRegion?: Record<string, Ec2CostPerformanceSummary>;
  },
  region?: string,
): Ec2CostPerformanceSummaryProjection | undefined {
  if (!region?.trim()) {
    return undefined;
  }

  const normalizedRegion = region.trim();
  if (!run.regions.includes(normalizedRegion)) {
    return undefined;
  }

  const summary = run.performanceSummariesByRegion?.[normalizedRegion];
  if (!summary) {
    return {
      availability: 'UNAVAILABLE',
      instancesEvaluated: 0,
      instancesWithMetrics: 0,
      instancesIncludedInAverage: 0,
      analysisRunId: run.runId,
      analyzedAt: run.completedAt,
    };
  }

  return {
    ...summary,
    analysisRunId: run.runId,
    analyzedAt: run.completedAt,
  };
}
