import type { EvidenceObservationRecord } from './types';
import { parseObservationTimestamp } from './timestamp-rules';
import {
  findObservationByLogicalId,
  selectRelevantPreviousObservation,
} from './observation-ordering';

export interface PriorObservationsForAssessment {
  priorObservations: EvidenceObservationRecord[];
  relevantPrevious: EvidenceObservationRecord | null;
}

/**
 * Builds the prior observation set used by the state machine.
 * Callers must supply all observations strictly before the current timestamp
 * or at minimum the single relevant previous observation.
 */
export function buildPriorObservationsForAssessment(input: {
  priorObservations: EvidenceObservationRecord[];
  currentObservationTimestamp: string;
  excludeLogicalObservationId?: string;
}): PriorObservationsForAssessment {
  const relevantPrevious = selectRelevantPreviousObservation(
    input.priorObservations,
    input.currentObservationTimestamp,
    input.excludeLogicalObservationId,
  );
  return {
    priorObservations: input.priorObservations,
    relevantPrevious,
  };
}

export function findDuplicateObservationInPrior(
  priorObservations: EvidenceObservationRecord[],
  logicalObservationId: string,
): EvidenceObservationRecord | null {
  return findObservationByLogicalId(priorObservations, logicalObservationId);
}

export function observationTimestampEpochMs(observationTimestamp: string): number {
  return parseObservationTimestamp(observationTimestamp).epochMs;
}
