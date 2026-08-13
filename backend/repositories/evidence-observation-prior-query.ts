import { parseObservationTimestamp } from '../persistence-intelligence/timestamp-rules';
import type { EvidenceObservationRecord } from '../persistence-intelligence/types';
import type { FindRelevantPreviousObservationInput } from './contracts/evidence-observation-repository';

export function isRelevantPreviousObservation(
  observation: EvidenceObservationRecord,
  input: FindRelevantPreviousObservationInput,
): boolean {
  if (observation.tenantId !== input.tenantId) {
    return false;
  }
  if (
    input.excludeLogicalObservationId &&
    observation.logicalObservationId === input.excludeLogicalObservationId
  ) {
    return false;
  }
  const currentMs = parseObservationTimestamp(input.beforeObservationTimestamp).epochMs;
  const observationMs = parseObservationTimestamp(observation.observationTimestamp).epochMs;
  return observationMs < currentMs;
}

export function selectLatestRelevantPreviousFromCandidates(
  candidates: EvidenceObservationRecord[],
  input: FindRelevantPreviousObservationInput,
): EvidenceObservationRecord | null {
  const filtered = candidates.filter((candidate) => isRelevantPreviousObservation(candidate, input));
  if (filtered.length === 0) {
    return null;
  }
  return filtered.reduce((latest, candidate) => {
    const latestMs = parseObservationTimestamp(latest.observationTimestamp).epochMs;
    const candidateMs = parseObservationTimestamp(candidate.observationTimestamp).epochMs;
    if (candidateMs > latestMs) {
      return candidate;
    }
    if (candidateMs < latestMs) {
      return latest;
    }
    return candidate.logicalObservationId.localeCompare(latest.logicalObservationId) > 0
      ? candidate
      : latest;
  });
}
