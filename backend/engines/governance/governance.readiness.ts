import type { ReadinessFactor, ReadinessResult, StandardizedEvidence } from '../../shared/types';
import { READINESS_STATUS } from '../../shared/constants';
import type { GovernanceConfig } from './governance.config';

export interface ReadinessInput {
  evidence: StandardizedEvidence;
  config: GovernanceConfig;
}

interface CriterionDefinition {
  name: string;
  weight: number;
  evaluate(evidence: StandardizedEvidence, config: GovernanceConfig): ReadinessFactor;
}

function scoreFactor(met: boolean, partialScore?: number): number {
  if (met) {
    return 100;
  }
  if (partialScore !== undefined) {
    return partialScore;
  }
  return 0;
}

const READINESS_CRITERIA: CriterionDefinition[] = [
  {
    name: 'telemetry-completeness',
    weight: 20,
    evaluate(evidence) {
      const { telemetry } = evidence;
      const hasCpu = telemetry.cpuUtilization >= 0;
      const hasMemory = telemetry.memoryUtilization >= 0;
      const hasNetwork = telemetry.networkUtilization !== undefined;
      const met = hasCpu && hasMemory;
      const partial = hasCpu || hasMemory ? 50 : 0;
      return {
        name: 'telemetry-completeness',
        score: scoreFactor(met, partial),
        weight: 20,
        met,
        detail: met
          ? `CPU ${telemetry.cpuUtilization}%, memory ${telemetry.memoryUtilization}%${hasNetwork ? ', network available' : ''}`
          : 'Telemetry data incomplete',
      };
    },
  },
  {
    name: 'metrics-availability',
    weight: 25,
    evaluate(evidence, config) {
      const datapoints = evidence.metrics.datapoints;
      const met = datapoints >= config.minMetricsDatapoints;
      const ratio = Math.min(datapoints / config.minMetricsDatapoints, 1);
      return {
        name: 'metrics-availability',
        score: Math.round(ratio * 100),
        weight: 25,
        met,
        detail: met
          ? `${datapoints} datapoints available`
          : `Only ${datapoints} datapoints — need ${config.minMetricsDatapoints}`,
      };
    },
  },
  {
    name: 'pricing-availability',
    weight: 15,
    evaluate(evidence) {
      const { pricing } = evidence;
      const met = pricing.hourlyRate > 0 && pricing.monthlyRate > 0;
      return {
        name: 'pricing-availability',
        score: scoreFactor(met),
        weight: 15,
        met,
        detail: met
          ? `${pricing.monthlyRate} ${pricing.currency}/month for ${pricing.instanceType}`
          : 'Pricing data unavailable',
      };
    },
  },
  {
    name: 'recommendation-availability',
    weight: 10,
    evaluate(evidence) {
      const count = evidence.recommendations.length;
      const met = count > 0;
      return {
        name: 'recommendation-availability',
        score: scoreFactor(met, 30),
        weight: 10,
        met,
        detail: met ? `${count} recommendation(s) available` : 'No recommendations available',
      };
    },
  },
  {
    name: 'tag-completeness',
    weight: 15,
    evaluate(evidence, config) {
      const present = config.requiredTags.filter((tag) => evidence.tags[tag]?.trim());
      const ratio = present.length / config.requiredTags.length;
      const met = ratio === 1;
      return {
        name: 'tag-completeness',
        score: Math.round(ratio * 100),
        weight: 15,
        met,
        detail: met
          ? `All required tags present (${present.join(', ')})`
          : `Missing tags: ${config.requiredTags.filter((t) => !evidence.tags[t]).join(', ') || 'none configured'}`,
      };
    },
  },
  {
    name: 'governance-metadata-completeness',
    weight: 15,
    evaluate(evidence, config) {
      const windowMet = evidence.telemetry.observationWindowDays >= config.minObservationWindowDays;
      const launchMet = evidence.instance.launchTime.trim().length > 0;
      const stateMet = evidence.instance.state.trim().length > 0;
      const scoreParts = [windowMet, launchMet, stateMet].filter(Boolean).length;
      const met = scoreParts === 3;
      return {
        name: 'governance-metadata-completeness',
        score: Math.round((scoreParts / 3) * 100),
        weight: 15,
        met,
        detail: met
          ? 'Observation window, launch time, and instance state are complete'
          : 'One or more governance metadata fields are incomplete',
      };
    },
  },
];

/**
 * Calculate a weighted readiness score from standardized evidence.
 * Reusable across the Governance Engine and plugin readiness hooks.
 */
export function calculateReadiness(input: ReadinessInput): ReadinessResult {
  const factors = READINESS_CRITERIA.map((criterion) =>
    criterion.evaluate(input.evidence, input.config)
  );

  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const weightedScore =
    totalWeight === 0
      ? 0
      : factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0) / totalWeight;

  const score = Math.round(weightedScore);
  const status = resolveReadinessStatus(score, input.config);

  return { score, status, factors };
}

function resolveReadinessStatus(score: number, config: GovernanceConfig): ReadinessResult['status'] {
  if (score >= config.readinessScoreReady) {
    return READINESS_STATUS.READY;
  }
  if (score >= config.readinessScorePartial) {
    return READINESS_STATUS.PARTIALLY_READY;
  }
  return READINESS_STATUS.NOT_READY;
}
