import type { EvidenceMaturity } from '../persistence-intelligence/types';
import { normalizeObservationTimestampIso } from '../persistence-intelligence/timestamp-rules';
import { EvidenceMaturityEvaluationError } from './errors';
import { DEFAULT_EVIDENCE_MATURITY_CONFIG } from './maturity-config';
import { computeMaturityScore } from './maturity-score';
import { MATURITY_REASON, type EvidenceMaturityReasonCode } from './reason-codes';
import { computeCurrentStableEpoch } from './stable-epoch';
import type { EvidenceMaturityAssessment, EvidenceMaturityEvaluationInput } from './types';

function assertEvaluationInput(input: EvidenceMaturityEvaluationInput): void {
  const source = input.sourceObservation;
  if (!source.tenantId?.trim()) {
    throw new EvidenceMaturityEvaluationError('Missing tenantId on source observation.');
  }
  if (!source.accountId?.trim()) {
    throw new EvidenceMaturityEvaluationError('Missing accountId on source observation.');
  }
  if (!source.findingKey?.trim()) {
    throw new EvidenceMaturityEvaluationError('Missing findingKey on source observation.');
  }
  if (!source.logicalObservationId?.trim()) {
    throw new EvidenceMaturityEvaluationError('Missing logicalObservationId on source observation.');
  }
  if (!input.evaluatedAt?.trim()) {
    throw new EvidenceMaturityEvaluationError('Missing evaluatedAt.');
  }
}

function uniqueReasonCodes(codes: EvidenceMaturityReasonCode[]): EvidenceMaturityReasonCode[] {
  return [...new Set(codes)];
}

function qualifiesForMature(input: {
  persistenceState: 'STABLE';
  stableEpochCount: number;
  stableEpochHours: number;
  telemetryApplicability: EvidenceMaturityEvaluationInput['telemetryApplicability'];
  dataCompleteness: EvidenceMaturityEvaluationInput['dataCompleteness'];
  matureMinObservationCount: number;
  matureMinStableEpochHours: number;
}): boolean {
  if (input.persistenceState !== 'STABLE') {
    return false;
  }
  if (input.stableEpochCount < input.matureMinObservationCount) {
    return false;
  }
  if (input.stableEpochHours < input.matureMinStableEpochHours) {
    return false;
  }
  if (input.telemetryApplicability === 'NOT_APPLICABLE') {
    return true;
  }
  return input.dataCompleteness === 'COMPLETE';
}

function qualifiesForPartial(input: {
  persistenceState: 'STABLE';
  stableEpochCount: number;
  stableEpochHours: number;
  partialMinObservationCount: number;
}): boolean {
  return (
    input.persistenceState === 'STABLE' &&
    input.stableEpochCount >= input.partialMinObservationCount &&
    input.stableEpochHours > 0
  );
}

export function evaluateEvidenceMaturity(
  input: EvidenceMaturityEvaluationInput,
): EvidenceMaturityAssessment {
  assertEvaluationInput(input);

  const config = input.config ?? DEFAULT_EVIDENCE_MATURITY_CONFIG;
  const source = input.sourceObservation;
  const persistenceState = source.assessment.state;
  const stableEpoch = computeCurrentStableEpoch({
    sourceObservation: source,
    findingHistory: input.findingHistory,
  });

  const reasonCodes: EvidenceMaturityReasonCode[] = [];
  let maturity: EvidenceMaturity = 'IMMATURE';

  if (persistenceState === 'NEW') {
    reasonCodes.push(MATURITY_REASON.FIRST_OBSERVATION);
  } else if (persistenceState === 'MISSING_PREVIOUS') {
    reasonCodes.push(MATURITY_REASON.PRIOR_HISTORY_MISSING);
  } else if (persistenceState === 'CHANGED') {
    reasonCodes.push(MATURITY_REASON.FINGERPRINT_CHANGED_RESET);
  } else if (input.telemetryApplicability === 'REQUIRED') {
    if (input.dataCompleteness === 'NO_DATA') {
      reasonCodes.push(MATURITY_REASON.TELEMETRY_NO_DATA);
    } else if (input.dataCompleteness === 'INSUFFICIENT') {
      reasonCodes.push(MATURITY_REASON.TELEMETRY_INSUFFICIENT);
    }
  } else {
    reasonCodes.push(MATURITY_REASON.TELEMETRY_NOT_APPLICABLE);
  }

  const telemetryBlocksMature =
    input.telemetryApplicability === 'REQUIRED' &&
    (input.dataCompleteness === 'NO_DATA' ||
      input.dataCompleteness === 'INSUFFICIENT' ||
      input.dataCompleteness === 'PARTIAL');

  if (
    persistenceState === 'STABLE' &&
    !reasonCodes.includes(MATURITY_REASON.TELEMETRY_NO_DATA) &&
    !reasonCodes.includes(MATURITY_REASON.TELEMETRY_INSUFFICIENT)
  ) {
    if (stableEpoch.observationCount < config.partialMinObservationCount) {
      reasonCodes.push(MATURITY_REASON.INSUFFICIENT_OBSERVATION_COUNT);
    } else if (
      qualifiesForMature({
        persistenceState: 'STABLE',
        stableEpochCount: stableEpoch.observationCount,
        stableEpochHours: stableEpoch.stableEpochHours,
        telemetryApplicability: input.telemetryApplicability,
        dataCompleteness: input.dataCompleteness,
        matureMinObservationCount: config.matureMinObservationCount,
        matureMinStableEpochHours: config.matureMinStableEpochHours,
      })
    ) {
      maturity = 'MATURE';
      reasonCodes.push(MATURITY_REASON.SUFFICIENT_OBSERVATION_COUNT);
      reasonCodes.push(MATURITY_REASON.SUFFICIENT_STABLE_EPOCH_DURATION);
      reasonCodes.push(MATURITY_REASON.STABLE_HISTORY_SUPPORTS_MATURE);
      if (input.telemetryApplicability === 'REQUIRED') {
        reasonCodes.push(MATURITY_REASON.TELEMETRY_COMPLETE);
      }
    } else if (
      qualifiesForPartial({
        persistenceState: 'STABLE',
        stableEpochCount: stableEpoch.observationCount,
        stableEpochHours: stableEpoch.stableEpochHours,
        partialMinObservationCount: config.partialMinObservationCount,
      })
    ) {
      maturity = 'PARTIAL';
      reasonCodes.push(MATURITY_REASON.STABLE_HISTORY_SUPPORTS_PARTIAL);
      if (stableEpoch.observationCount >= config.matureMinObservationCount) {
        reasonCodes.push(MATURITY_REASON.SUFFICIENT_OBSERVATION_COUNT);
      } else {
        reasonCodes.push(MATURITY_REASON.INSUFFICIENT_OBSERVATION_COUNT);
      }
      if (stableEpoch.stableEpochHours >= config.matureMinStableEpochHours) {
        reasonCodes.push(MATURITY_REASON.SUFFICIENT_STABLE_EPOCH_DURATION);
      } else {
        reasonCodes.push(MATURITY_REASON.INSUFFICIENT_STABLE_EPOCH_DURATION);
      }
      if (telemetryBlocksMature && input.dataCompleteness === 'PARTIAL') {
        reasonCodes.push(MATURITY_REASON.TELEMETRY_PARTIAL);
      }
    } else if (stableEpoch.stableEpochHours <= 0) {
      reasonCodes.push(MATURITY_REASON.INSUFFICIENT_STABLE_EPOCH_DURATION);
    }
  }

  const scoreResult = computeMaturityScore({
    persistenceState,
    stableEpoch,
    telemetryApplicability: input.telemetryApplicability,
    evidenceCompleteness: input.dataCompleteness,
    matureMinObservationCount: config.matureMinObservationCount,
    matureMinStableEpochHours: config.matureMinStableEpochHours,
  });

  return {
    maturity,
    score: scoreResult.score,
    reasonCodes: uniqueReasonCodes(reasonCodes),
    observationCount: stableEpoch.observationCount,
    stableEpochObservationCount: stableEpoch.observationCount,
    persistenceHours: source.assessment.persistenceHours,
    stableEpochHours: stableEpoch.stableEpochHours,
    evidenceCompleteness: input.dataCompleteness,
    telemetryApplicability: input.telemetryApplicability,
    evaluatedAt: input.evaluatedAt,
    sourceObservationTimestamp: normalizeObservationTimestampIso(source.observationTimestamp),
    modelVersion: config.modelVersion,
    sourceObservationId: source.observationId,
    sourceLogicalObservationId: source.logicalObservationId,
    sourcePersistenceState: persistenceState,
    tenantId: source.tenantId,
    accountId: source.accountId,
    region: source.region,
    resourceId: source.resourceId,
    findingKey: source.findingKey,
    recommendationFingerprint: source.recommendationFingerprint,
    ruleId: source.ruleId,
    ruleVersion: source.ruleVersion,
    category: source.category,
    analysisRunId: source.analysisRunId,
    stableEpochObservationIds: stableEpoch.observations.map((observation) => observation.observationId),
    stableEpochLogicalObservationIds: stableEpoch.observations.map(
      (observation) => observation.logicalObservationId,
    ),
    scoreFactors: scoreResult.factors,
  };
}
