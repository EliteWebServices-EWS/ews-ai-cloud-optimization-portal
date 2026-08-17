import type { EvidenceMaturity, PersistenceState } from '../persistence-intelligence/types';
import type {
  MaturityScoreFactor,
  StableEpochResult,
  TelemetryApplicability,
} from './types';

const STATE_WEIGHT = 25;
const COUNT_WEIGHT = 25;
const DURATION_WEIGHT = 25;
const TELEMETRY_WEIGHT = 25;

function stateFactor(state: PersistenceState): MaturityScoreFactor {
  const satisfied = state === 'STABLE';
  return {
    factor: 'persistence-state',
    weight: STATE_WEIGHT,
    earned: satisfied ? STATE_WEIGHT : 0,
    satisfied,
    detail: state,
  };
}

function countFactor(count: number, matureMin: number): MaturityScoreFactor {
  const ratio = Math.min(count / matureMin, 1);
  const earned = Math.round(ratio * COUNT_WEIGHT);
  return {
    factor: 'stable-epoch-observation-count',
    weight: COUNT_WEIGHT,
    earned,
    satisfied: count >= matureMin,
    detail: String(count),
  };
}

function durationFactor(hours: number, matureMinHours: number): MaturityScoreFactor {
  const ratio = Math.min(hours / matureMinHours, 1);
  const earned = Math.round(ratio * DURATION_WEIGHT);
  return {
    factor: 'stable-epoch-duration-hours',
    weight: DURATION_WEIGHT,
    earned,
    satisfied: hours >= matureMinHours,
    detail: String(hours),
  };
}

function telemetryFactor(
  applicability: TelemetryApplicability,
  completeness: string,
): MaturityScoreFactor {
  if (applicability === 'NOT_APPLICABLE') {
    return {
      factor: 'telemetry-quality',
      weight: TELEMETRY_WEIGHT,
      earned: TELEMETRY_WEIGHT,
      satisfied: true,
      detail: 'NOT_APPLICABLE',
    };
  }
  let earned = 0;
  let satisfied = false;
  switch (completeness) {
    case 'COMPLETE':
      earned = TELEMETRY_WEIGHT;
      satisfied = true;
      break;
    case 'PARTIAL':
      earned = 15;
      break;
    case 'INSUFFICIENT':
      earned = 5;
      break;
    default:
      earned = 0;
      break;
  }
  return {
    factor: 'telemetry-quality',
    weight: TELEMETRY_WEIGHT,
    earned,
    satisfied,
    detail: completeness,
  };
}

export interface MaturityScoreResult {
  score: number;
  factors: MaturityScoreFactor[];
}

/** Transparent factor checklist — classification is authoritative; score is secondary. */
export function computeMaturityScore(input: {
  persistenceState: PersistenceState;
  stableEpoch: StableEpochResult;
  telemetryApplicability: TelemetryApplicability;
  evidenceCompleteness: string;
  matureMinObservationCount: number;
  matureMinStableEpochHours: number;
}): MaturityScoreResult {
  const factors = [
    stateFactor(input.persistenceState),
    countFactor(input.stableEpoch.observationCount, input.matureMinObservationCount),
    durationFactor(input.stableEpoch.stableEpochHours, input.matureMinStableEpochHours),
    telemetryFactor(input.telemetryApplicability, input.evidenceCompleteness),
  ];
  const score = Math.min(
    100,
    Math.max(0, factors.reduce((total, factor) => total + factor.earned, 0)),
  );
  return { score, factors };
}

/** Score is never used to derive classification — exported for tests only. */
export function maturityFromScoreOnly(_score: number): EvidenceMaturity {
  throw new Error('Score must not derive maturity classification.');
}
