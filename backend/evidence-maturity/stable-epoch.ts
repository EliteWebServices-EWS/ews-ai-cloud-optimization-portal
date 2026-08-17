import { sortObservationsByObservationTimestamp } from '../persistence-intelligence/observation-ordering';
import { parseObservationTimestamp } from '../persistence-intelligence/timestamp-rules';
import type { EvidenceObservationRecord } from '../persistence-intelligence/types';
import type { StableEpochResult } from './types';

/**
 * Derives the current stable epoch: uninterrupted same-fingerprint observations
 * ending at the source observation, ordered by observation timestamp.
 */
export function computeCurrentStableEpoch(input: {
  sourceObservation: EvidenceObservationRecord;
  findingHistory: EvidenceObservationRecord[];
}): StableEpochResult {
  const source = input.sourceObservation;
  const currentFingerprint = source.recommendationFingerprint;
  const sourceMs = parseObservationTimestamp(source.observationTimestamp).epochMs;

  const scoped = input.findingHistory.filter(
    (observation) =>
      observation.tenantId === source.tenantId &&
      observation.accountId === source.accountId &&
      observation.findingKey === source.findingKey &&
      parseObservationTimestamp(observation.observationTimestamp).epochMs <= sourceMs,
  );

  const sorted = sortObservationsByObservationTimestamp(scoped);
  const sourceIndex = sorted.findIndex(
    (observation) => observation.logicalObservationId === source.logicalObservationId,
  );
  const throughSource =
    sourceIndex >= 0 ? sorted.slice(0, sourceIndex + 1) : [...sorted, source];

  const epoch: EvidenceObservationRecord[] = [];
  for (let index = throughSource.length - 1; index >= 0; index -= 1) {
    const candidate = throughSource[index]!;
    if (candidate.recommendationFingerprint !== currentFingerprint) {
      break;
    }
    epoch.unshift(candidate);
  }

  if (epoch.length === 0) {
    epoch.push(source);
  }

  const earliest = epoch[0]!;
  const latest = epoch[epoch.length - 1]!;
  const earliestMs = parseObservationTimestamp(earliest.observationTimestamp).epochMs;
  const latestMs = parseObservationTimestamp(latest.observationTimestamp).epochMs;
  const stableEpochHours = Math.max(0, (latestMs - earliestMs) / (1000 * 60 * 60));

  return {
    observations: epoch,
    observationCount: epoch.length,
    stableEpochHours,
    earliestObservationTimestamp: earliest.observationTimestamp,
    latestObservationTimestamp: latest.observationTimestamp,
  };
}
