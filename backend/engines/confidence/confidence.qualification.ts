import type { ConfidenceStatus } from '../../shared/constants';
import { CONFIDENCE_STATUS } from '../../shared/constants';
import type {
  ConfidenceLongitudinalEvidence,
  ConfidenceResult,
  StandardizedEvidence,
} from '../../shared/types';
import type { ConfidenceConfig } from './confidence.config';
import {
  CONFIDENCE_REASON,
  sortConfidenceReasonCodes,
  type ConfidenceReasonCode,
} from '../../shared/confidence/reason-codes';

const STATUS_RANK: Record<ConfidenceStatus, number> = {
  [CONFIDENCE_STATUS.LOW]: 0,
  [CONFIDENCE_STATUS.MEDIUM]: 1,
  [CONFIDENCE_STATUS.HIGH]: 2,
  [CONFIDENCE_STATUS.NOT_APPLICABLE]: -1,
};

function applyStatusCeiling(
  rawStatus: ConfidenceStatus,
  ceiling: ConfidenceStatus | null,
): ConfidenceStatus {
  if (!ceiling) {
    return rawStatus;
  }
  return STATUS_RANK[rawStatus] <= STATUS_RANK[ceiling] ? rawStatus : ceiling;
}

function mostRestrictiveCeiling(
  left: ConfidenceStatus | null,
  right: ConfidenceStatus | null,
): ConfidenceStatus | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return STATUS_RANK[left] < STATUS_RANK[right] ? left : right;
}

function persistenceStateReasonCode(state: NonNullable<ConfidenceLongitudinalEvidence['persistence']>['state']): ConfidenceReasonCode {
  switch (state) {
    case 'STABLE':
      return CONFIDENCE_REASON.PERSISTENCE_STABLE;
    case 'NEW':
      return CONFIDENCE_REASON.PERSISTENCE_NEW;
    case 'CHANGED':
      return CONFIDENCE_REASON.PERSISTENCE_CHANGED;
    case 'MISSING_PREVIOUS':
      return CONFIDENCE_REASON.PERSISTENCE_MISSING_PREVIOUS;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function persistenceStateCeiling(
  state: NonNullable<ConfidenceLongitudinalEvidence['persistence']>['state'],
): ConfidenceStatus | null {
  switch (state) {
    case 'STABLE':
      return null;
    case 'NEW':
    case 'CHANGED':
      return CONFIDENCE_STATUS.MEDIUM;
    case 'MISSING_PREVIOUS':
      return CONFIDENCE_STATUS.LOW;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function maturityReasonCode(
  maturity: NonNullable<ConfidenceLongitudinalEvidence['maturity']>['maturity'],
): ConfidenceReasonCode {
  switch (maturity) {
    case 'MATURE':
      return CONFIDENCE_REASON.MATURITY_MATURE;
    case 'PARTIAL':
      return CONFIDENCE_REASON.MATURITY_PARTIAL;
    case 'IMMATURE':
      return CONFIDENCE_REASON.MATURITY_IMMATURE;
    default: {
      const exhaustive: never = maturity;
      return exhaustive;
    }
  }
}

function maturityCeiling(
  maturity: NonNullable<ConfidenceLongitudinalEvidence['maturity']>['maturity'],
): ConfidenceStatus | null {
  switch (maturity) {
    case 'MATURE':
      return null;
    case 'PARTIAL':
      return CONFIDENCE_STATUS.MEDIUM;
    case 'IMMATURE':
      return CONFIDENCE_STATUS.LOW;
    default: {
      const exhaustive: never = maturity;
      return exhaustive;
    }
  }
}

function telemetryCompletenessReasonCode(
  completeness: NonNullable<ConfidenceLongitudinalEvidence['maturity']>['evidenceCompleteness'],
): ConfidenceReasonCode | null {
  switch (completeness) {
    case 'COMPLETE':
      return null;
    case 'PARTIAL':
      return CONFIDENCE_REASON.TELEMETRY_PARTIAL;
    case 'INSUFFICIENT':
      return CONFIDENCE_REASON.TELEMETRY_INSUFFICIENT;
    case 'NO_DATA':
      return CONFIDENCE_REASON.TELEMETRY_NO_DATA;
    case 'NOT_APPLICABLE':
      return CONFIDENCE_REASON.TELEMETRY_NOT_APPLICABLE;
    default: {
      const exhaustive: never = completeness;
      return exhaustive;
    }
  }
}

function telemetryCompletenessCeiling(
  completeness: NonNullable<ConfidenceLongitudinalEvidence['maturity']>['evidenceCompleteness'],
): ConfidenceStatus | null {
  switch (completeness) {
    case 'COMPLETE':
    case 'NOT_APPLICABLE':
      return null;
    case 'PARTIAL':
      return CONFIDENCE_STATUS.MEDIUM;
    case 'INSUFFICIENT':
    case 'NO_DATA':
      return CONFIDENCE_STATUS.LOW;
    default: {
      const exhaustive: never = completeness;
      return exhaustive;
    }
  }
}

export interface QualifyConfidenceStatusInput {
  rawStatus: ConfidenceStatus;
  evidence: StandardizedEvidence;
  config: ConfidenceConfig;
  longitudinalEvidence?: ConfidenceLongitudinalEvidence;
}

export interface QualifyConfidenceStatusResult {
  finalStatus: ConfidenceStatus;
  reasonCodes: ConfidenceReasonCode[];
}

export function qualifyConfidenceStatus(
  input: QualifyConfidenceStatusInput,
): QualifyConfidenceStatusResult {
  const reasonCodes: ConfidenceReasonCode[] = [];
  let ceiling: ConfidenceStatus | null = null;
  const persistence = input.longitudinalEvidence?.persistence;
  const maturity = input.longitudinalEvidence?.maturity;
  const hasAuthoritativePersistence = Boolean(persistence);
  let maturityQualificationEnabled = Boolean(maturity);

  if (!hasAuthoritativePersistence) {
    reasonCodes.push(
      CONFIDENCE_REASON.PERSISTENCE_HISTORY_ABSENT,
      CONFIDENCE_REASON.PERSISTENCE_PROVIDER_HINT_FALLBACK,
      CONFIDENCE_REASON.LEGACY_COMMERCIAL_FALLBACK,
    );
    ceiling = mostRestrictiveCeiling(ceiling, CONFIDENCE_STATUS.MEDIUM);
  } else {
    reasonCodes.push(persistenceStateReasonCode(persistence!.state));
    ceiling = mostRestrictiveCeiling(ceiling, persistenceStateCeiling(persistence!.state));
  }

  if (persistence && maturity) {
    if (persistence.sourceObservationId !== maturity.sourceObservationId) {
      reasonCodes.push(CONFIDENCE_REASON.MATURITY_SOURCE_OBSERVATION_MISMATCH);
      maturityQualificationEnabled = false;
    } else if (persistence.state !== maturity.sourcePersistenceState) {
      reasonCodes.push(CONFIDENCE_REASON.PERSISTENCE_MATURITY_STATE_MISMATCH);
      ceiling = mostRestrictiveCeiling(ceiling, CONFIDENCE_STATUS.LOW);
    } else if (persistence.persistenceHours !== maturity.persistenceHours) {
      reasonCodes.push(CONFIDENCE_REASON.PERSISTENCE_HOURS_MISMATCH);
      ceiling = mostRestrictiveCeiling(ceiling, CONFIDENCE_STATUS.LOW);
    }
  }

  if (maturityQualificationEnabled && maturity) {
    reasonCodes.push(maturityReasonCode(maturity.maturity));
    ceiling = mostRestrictiveCeiling(ceiling, maturityCeiling(maturity.maturity));

    const telemetryReason = telemetryCompletenessReasonCode(maturity.evidenceCompleteness);
    if (telemetryReason) {
      reasonCodes.push(telemetryReason);
    }
    ceiling = mostRestrictiveCeiling(
      ceiling,
      telemetryCompletenessCeiling(maturity.evidenceCompleteness),
    );
  }

  if (input.evidence.metrics.datapoints < input.config.minMetricsDatapoints) {
    reasonCodes.push(CONFIDENCE_REASON.METRICS_PARTIAL);
  }

  if (input.evidence.telemetry.observationWindowDays < input.config.minObservationWindowDays) {
    reasonCodes.push(CONFIDENCE_REASON.OBSERVATION_WINDOW_INSUFFICIENT);
  }

  const governance = input.longitudinalEvidence?.governanceConvergence;
  if (!governance || governance.contextAvailable === false) {
    reasonCodes.push(CONFIDENCE_REASON.GOVERNANCE_CONTEXT_MISSING);
  }

  const finalStatus = applyStatusCeiling(input.rawStatus, ceiling);
  if (finalStatus !== input.rawStatus) {
    reasonCodes.push(CONFIDENCE_REASON.STATUS_CEILING_APPLIED);
  }

  return {
    finalStatus,
    reasonCodes: sortConfidenceReasonCodes(reasonCodes),
  };
}

export function buildQualifiedReason(
  rawStatus: ConfidenceStatus,
  finalStatus: ConfidenceStatus,
  commercialScore: number,
  baseReason: string,
): string {
  if (rawStatus === finalStatus) {
    return baseReason;
  }

  return `${baseReason} — evidence-aware qualification adjusted final status from ${rawStatus} to ${finalStatus} (commercial score ${commercialScore})`;
}

export function toLegacyLevel(status: ConfidenceResult['status']): ConfidenceResult['level'] {
  if (status === CONFIDENCE_STATUS.HIGH) {
    return 'high';
  }
  if (status === CONFIDENCE_STATUS.MEDIUM) {
    return 'medium';
  }
  return 'low';
}
