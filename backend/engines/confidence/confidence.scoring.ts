import type { ConfidenceFactor, ConfidenceResult, StandardizedEvidence } from '../../shared/types';
import type { EvidenceValidationResult } from '../../shared/types';
import { CONFIDENCE_STATUS } from '../../shared/constants';
import type { ConfidenceConfig } from './confidence.config';

export interface ConfidenceInput {
  evidence: StandardizedEvidence;
  validation: EvidenceValidationResult;
  resourceId: string;
  config: ConfidenceConfig;
}

interface CriterionDefinition {
  name: string;
  weight: number;
  evaluate(
    evidence: StandardizedEvidence,
    validation: EvidenceValidationResult,
    resourceId: string,
    config: ConfidenceConfig
  ): ConfidenceFactor;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) {
    return 1;
  }
  const mean = average(values);
  if (mean === 0) {
    return 0;
  }
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function stabilityScore(values: number[], maxCv: number): number {
  const cv = coefficientOfVariation(values);
  if (cv <= maxCv) {
    return 100;
  }
  if (cv >= maxCv * 2) {
    return 0;
  }
  return Math.round((1 - (cv - maxCv) / maxCv) * 100);
}

const CONFIDENCE_CRITERIA: CriterionDefinition[] = [
  {
    name: 'workload-stability',
    weight: 25,
    evaluate(evidence, _validation, _resourceId, config) {
      const cpuScore = stabilityScore(evidence.metrics.cpuUtilization, config.maxCpuCoefficientOfVariation);
      const memoryScore = stabilityScore(
        evidence.metrics.memoryUtilization,
        config.maxCpuCoefficientOfVariation
      );
      const score = Math.round((cpuScore + memoryScore) / 2);
      return {
        name: 'workload-stability',
        score,
        weight: 25,
        detail:
          score >= 80
            ? 'CPU and memory utilization are stable over the observation period'
            : 'Workload shows variability that may affect optimization confidence',
      };
    },
  },
  {
    name: 'historical-consistency',
    weight: 20,
    evaluate(evidence, _validation, _resourceId, config) {
      const historyCount = evidence.metrics.utilizationHistory.length;
      const ratio = Math.min(historyCount / config.minHistoryEntries, 1);
      return {
        name: 'historical-consistency',
        score: Math.round(ratio * 100),
        weight: 20,
        detail:
          historyCount >= config.minHistoryEntries
            ? `${historyCount} utilization history entries available`
            : `Only ${historyCount} history entries — need ${config.minHistoryEntries}`,
      };
    },
  },
  {
    name: 'recommendation-persistence',
    weight: 15,
    evaluate(evidence, _validation, resourceId) {
      const match = evidence.recommendations.find((rec) => rec.resourceId === resourceId);
      const score = match ? 100 : 20;
      return {
        name: 'recommendation-persistence',
        score,
        weight: 15,
        detail: match
          ? `Provider recommendation persists for target ${match.target}`
          : 'No persistent provider recommendation hint available',
      };
    },
  },
  {
    name: 'metrics-quality',
    weight: 20,
    evaluate(evidence, _validation, _resourceId, config) {
      const datapoints = evidence.metrics.datapoints;
      const ratio = Math.min(datapoints / config.minMetricsDatapoints, 1);
      return {
        name: 'metrics-quality',
        score: Math.round(ratio * 100),
        weight: 20,
        detail: `${datapoints} metrics datapoints collected`,
      };
    },
  },
  {
    name: 'evidence-completeness',
    weight: 10,
    evaluate(_evidence, validation) {
      const score = validation.valid ? 100 : Math.max(0, 100 - validation.errors.length * 25);
      return {
        name: 'evidence-completeness',
        score,
        weight: 10,
        detail: validation.valid
          ? 'Evidence validation passed without errors'
          : `Evidence validation issues: ${validation.errors.join('; ') || 'unknown'}`,
      };
    },
  },
  {
    name: 'telemetry-continuity',
    weight: 10,
    evaluate(evidence, _validation, _resourceId, config) {
      const windowDays = evidence.telemetry.observationWindowDays;
      const ratio = Math.min(windowDays / config.minObservationWindowDays, 1);
      return {
        name: 'telemetry-continuity',
        score: Math.round(ratio * 100),
        weight: 10,
        detail: `${windowDays}-day observation window`,
      };
    },
  },
];

function resolveConfidenceStatus(
  score: number,
  config: ConfidenceConfig
): ConfidenceResult['status'] {
  if (score >= config.scoreHigh) {
    return CONFIDENCE_STATUS.HIGH;
  }
  if (score >= config.scoreMedium) {
    return CONFIDENCE_STATUS.MEDIUM;
  }
  return CONFIDENCE_STATUS.LOW;
}

function toLegacyLevel(status: ConfidenceResult['status']): ConfidenceResult['level'] {
  if (status === CONFIDENCE_STATUS.HIGH) {
    return 'high';
  }
  if (status === CONFIDENCE_STATUS.MEDIUM) {
    return 'medium';
  }
  return 'low';
}

function buildConfidenceReason(status: ConfidenceResult['status'], score: number): string {
  if (status === CONFIDENCE_STATUS.HIGH) {
    return `High confidence (${score}) — stable workload over observation period`;
  }
  if (status === CONFIDENCE_STATUS.MEDIUM) {
    return `Medium confidence (${score}) — sufficient data with some variability`;
  }
  return `Low confidence (${score}) — insufficient or inconsistent evidence for recommendation`;
}

/**
 * Calculate weighted confidence score from evidence and validation.
 * Separate from readiness — measures trust in the optimization decision.
 */
export function calculateConfidence(input: ConfidenceInput): ConfidenceResult {
  const factors = CONFIDENCE_CRITERIA.map((criterion) =>
    criterion.evaluate(input.evidence, input.validation, input.resourceId, input.config)
  );

  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const weightedScore =
    totalWeight === 0
      ? 0
      : factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0) / totalWeight;

  const score = Math.round(weightedScore);
  const status = resolveConfidenceStatus(score, input.config);
  const reason = buildConfidenceReason(status, score);

  return {
    score,
    status,
    reason,
    factors,
    level: toLegacyLevel(status),
  };
}
