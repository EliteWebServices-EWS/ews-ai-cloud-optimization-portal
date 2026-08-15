import { EVIDENCE_STATUS } from '../../../shared/constants';
import type {
  EvidenceValidationResult,
  StandardizedEvidence,
} from '../../../shared/types';
import {
  FIXED_COLLECTED_AT,
  REGION,
  RESOURCE_ID_CONFIDENCE_GOLDEN,
} from './identities';

function cloneEvidence(evidence: StandardizedEvidence): StandardizedEvidence {
  return structuredClone(evidence);
}

/** Golden complete evidence used by the frozen commercial confidence baseline (score 100). */
export function buildHealthyEvidence(
  overrides: Partial<StandardizedEvidence> & { resourceId?: string } = {},
): StandardizedEvidence {
  const resourceId = overrides.resourceId ?? RESOURCE_ID_CONFIDENCE_GOLDEN;
  const base: StandardizedEvidence = {
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
      region: REGION,
      hourlyRate: 0.0416,
      monthlyRate: 30.37,
      currency: 'USD',
    },
    recommendations: [
      {
        resourceId,
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
      instanceId: resourceId,
      instanceType: 't3.medium',
      state: 'running',
      region: REGION,
      launchTime: '2026-01-01T00:00:00.000Z',
    },
    collectedAt: FIXED_COLLECTED_AT,
  };

  const { resourceId: _ignored, ...rest } = overrides;
  return cloneEvidence({ ...base, ...rest });
}

/** Evidence with insufficient history/metrics for completeness scoring (not engine INCOMPLETE). */
export function buildIncompleteEvidence(): StandardizedEvidence {
  return buildHealthyEvidence({
    metrics: {
      cpuUtilization: [20],
      memoryUtilization: [40],
      period: '1h',
      datapoints: 1,
      utilizationHistory: [],
    },
    telemetry: {
      cpuUtilization: 20,
      memoryUtilization: 40,
      observationWindowDays: 1,
    },
  });
}

/** Evidence with no usable metric series. */
export function buildNoDataEvidence(): StandardizedEvidence {
  return buildHealthyEvidence({
    metrics: {
      cpuUtilization: [],
      memoryUtilization: [],
      period: '1h',
      datapoints: 0,
      utilizationHistory: [],
    },
    telemetry: {
      cpuUtilization: 0,
      memoryUtilization: 0,
      observationWindowDays: 0,
    },
    recommendations: [],
  });
}

/** Evidence missing usable pricing fields (validation should fail). */
export function buildMissingPricingEvidence(): StandardizedEvidence {
  return buildHealthyEvidence({
    pricing: {
      instanceType: '',
      region: REGION,
      hourlyRate: 0,
      monthlyRate: 0,
      currency: '',
    },
  });
}

export function buildHealthyValidation(): EvidenceValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

export function buildIncompleteValidation(): EvidenceValidationResult {
  return {
    valid: false,
    errors: ['Pricing evidence requires review'],
    warnings: [],
  };
}

export function buildMissingPricingValidation(): EvidenceValidationResult {
  return {
    valid: false,
    errors: ['Pricing block is missing required instanceType', 'Pricing currency is required'],
    warnings: [],
  };
}

export function buildNoDataValidation(): EvidenceValidationResult {
  return {
    valid: false,
    errors: ['Metrics datapoints below minimum', 'Utilization history is empty'],
    warnings: ['No provider recommendation present'],
  };
}

/** Evidence status representing incomplete engine-boundary input. */
export const INCOMPLETE_EVIDENCE_STATUS = EVIDENCE_STATUS.INCOMPLETE;
export const COMPLETE_EVIDENCE_STATUS = EVIDENCE_STATUS.COMPLETE;

export { RESOURCE_ID_CONFIDENCE_GOLDEN };
