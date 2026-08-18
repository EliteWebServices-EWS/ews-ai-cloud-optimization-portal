import type {
  ConfidenceFactor,
  ConfidenceLongitudinalEvidence,
  ConfidenceResult,
  StandardizedEvidence,
} from '../../shared/types';
import type { EvidenceValidationResult } from '../../shared/types';
import { CONFIDENCE_STATUS } from '../../shared/constants';
import {
  CONFIDENCE_FORMULA_VERSION,
  CONFIDENCE_MODEL_VERSION,
  DEFAULT_CONFIDENCE_CONFIG,
  type ConfidenceConfig,
} from './confidence.config';
import {
  buildQualifiedReason,
  qualifyConfidenceStatus,
  toLegacyLevel,
} from './confidence.qualification';

export interface ConfidenceInput {
  evidence: StandardizedEvidence;
  validation: EvidenceValidationResult;
  resourceId: string;
  config: ConfidenceConfig;
  longitudinalEvidence?: ConfidenceLongitudinalEvidence;
}

interface CriterionDefinition {
  name: string;
  weight: number;
  evaluate(
    evidence: StandardizedEvidence,
    validation: EvidenceValidationResult,
    resourceId: string,
    config: ConfidenceConfig,
    longitudinalEvidence?: ConfidenceLongitudinalEvidence,
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

function scoreAuthoritativePersistence(
  state: NonNullable<ConfidenceLongitudinalEvidence['persistence']>['state'],
): { score: number; detail: string } {
  switch (state) {
    case 'STABLE':
      return {
        score: 100,
        detail: 'Authoritative persistence state STABLE for recommendation fingerprint',
      };
    case 'NEW':
      return {
        score: 40,
        detail: 'Authoritative persistence state NEW — first observation for finding',
      };
    case 'CHANGED':
      return {
        score: 20,
        detail: 'Authoritative persistence state CHANGED — recommendation fingerprint changed',
      };
    case 'MISSING_PREVIOUS':
      return {
        score: 0,
        detail: 'Authoritative persistence state MISSING_PREVIOUS — prior history absent',
      };
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function scoreLegacyProviderPersistence(
  evidence: StandardizedEvidence,
  resourceId: string,
): { score: number; detail: string } {
  const match = evidence.recommendations.find((rec) => rec.resourceId === resourceId);
  return {
    score: match ? 100 : 20,
    detail: match
      ? `Provider recommendation persists for target ${match.target}`
      : 'No persistent provider recommendation hint available',
  };
}

const CONFIDENCE_CRITERIA: CriterionDefinition[] = [
  {
    name: 'workload-stability',
    weight: 25,
    evaluate(evidence, _validation, _resourceId, config) {
      const cpuScore = stabilityScore(evidence.metrics.cpuUtilization, config.maxCpuCoefficientOfVariation);
      const memoryScore = stabilityScore(
        evidence.metrics.memoryUtilization,
        config.maxCpuCoefficientOfVariation,
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
    evaluate(evidence, _validation, resourceId, _config, longitudinalEvidence) {
      const authoritative = longitudinalEvidence?.persistence;
      const scored = authoritative
        ? scoreAuthoritativePersistence(authoritative.state)
        : scoreLegacyProviderPersistence(evidence, resourceId);

      return {
        name: 'recommendation-persistence',
        score: scored.score,
        weight: 15,
        detail: scored.detail,
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

function resolveCommercialStatus(
  score: number,
  config: ConfidenceConfig,
): ConfidenceResult['status'] {
  if (score >= config.scoreHigh) {
    return CONFIDENCE_STATUS.HIGH;
  }
  if (score >= config.scoreMedium) {
    return CONFIDENCE_STATUS.MEDIUM;
  }
  return CONFIDENCE_STATUS.LOW;
}

/** Resolves Sprint 1 raw threshold status from a commercial score without v2 qualification. */
export function resolveRawCommercialStatus(
  score: number,
  config?: ConfidenceConfig,
): ConfidenceResult['status'] {
  return resolveCommercialStatus(score, config ?? DEFAULT_CONFIDENCE_CONFIG);
}

function buildCommercialReason(
  status: ConfidenceResult['status'],
  score: number,
  factors: ConfidenceFactor[],
): string {
  if (status === CONFIDENCE_STATUS.HIGH) {
    const weakFactors = factors.filter((factor) => factor.score < 100);
    if (weakFactors.length > 0) {
      const summary = weakFactors.map((factor) => `${factor.name}: ${factor.detail}`).join('; ');
      return `High confidence (${score}) — commercial score strong with factor limitations: ${summary}`;
    }
    return `High confidence (${score}) — stable workload over observation period`;
  }
  if (status === CONFIDENCE_STATUS.MEDIUM) {
    return `Medium confidence (${score}) — sufficient data with some variability`;
  }
  return `Low confidence (${score}) — insufficient or inconsistent evidence for recommendation`;
}

/**
 * Calculate weighted confidence score from evidence and validation, then apply
 * evidence-aware v2 qualification without mutating the frozen commercial score.
 */
export function calculateConfidence(input: ConfidenceInput): ConfidenceResult {
  const factors = CONFIDENCE_CRITERIA.map((criterion) =>
    criterion.evaluate(
      input.evidence,
      input.validation,
      input.resourceId,
      input.config,
      input.longitudinalEvidence,
    ),
  );

  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const weightedScore =
    totalWeight === 0
      ? 0
      : factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0) / totalWeight;

  const commercialScore = Math.round(weightedScore);
  const rawStatus = resolveCommercialStatus(commercialScore, input.config);
  const commercialReason = buildCommercialReason(rawStatus, commercialScore, factors);

  const qualification = qualifyConfidenceStatus({
    rawStatus,
    evidence: input.evidence,
    config: input.config,
    longitudinalEvidence: input.longitudinalEvidence,
  });

  const reason = buildQualifiedReason(
    rawStatus,
    qualification.finalStatus,
    commercialScore,
    commercialReason,
  );

  return {
    score: commercialScore,
    commercialScore,
    status: qualification.finalStatus,
    reason,
    factors,
    formulaVersion: CONFIDENCE_FORMULA_VERSION,
    confidenceModelVersion: CONFIDENCE_MODEL_VERSION,
    reasonCodes: qualification.reasonCodes,
    level: toLegacyLevel(qualification.finalStatus),
  };
}
