import { createHash } from 'node:crypto';

import { stableStringify } from './canonical-json';
import { parseObservationTimestamp } from './timestamp-rules';
import type { EvidenceObservationRecord } from './types';

export function buildLogicalObservationId(input: {
  tenantId: string;
  accountId: string;
  findingKey: string;
  analysisRunId: string;
  observationTimestamp: string;
}): string {
  return createHash('sha256')
    .update(
      stableStringify({
        tenantId: input.tenantId,
        accountId: input.accountId,
        findingKey: input.findingKey,
        analysisRunId: input.analysisRunId,
        observationTimestamp: parseObservationTimestamp(input.observationTimestamp).iso,
      }),
      'utf8',
    )
    .digest('hex');
}

export function sortObservationsByObservationTimestamp(
  observations: EvidenceObservationRecord[],
): EvidenceObservationRecord[] {
  return [...observations].sort((left, right) => {
    const leftMs = parseObservationTimestamp(left.observationTimestamp).epochMs;
    const rightMs = parseObservationTimestamp(right.observationTimestamp).epochMs;
    if (leftMs !== rightMs) {
      return leftMs - rightMs;
    }
    return left.logicalObservationId.localeCompare(right.logicalObservationId);
  });
}

/**
 * Historical ordering authority: observationTimestamp ascending.
 * Relevant previous observation = latest record strictly before current observationTimestamp.
 */
export function selectRelevantPreviousObservation(
  observations: EvidenceObservationRecord[],
  currentObservationTimestamp: string,
  excludeLogicalObservationId?: string,
): EvidenceObservationRecord | null {
  const currentMs = parseObservationTimestamp(currentObservationTimestamp).epochMs;
  const candidates = sortObservationsByObservationTimestamp(observations).filter((observation) => {
    if (excludeLogicalObservationId && observation.logicalObservationId === excludeLogicalObservationId) {
      return false;
    }
    const obsMs = parseObservationTimestamp(observation.observationTimestamp).epochMs;
    return obsMs < currentMs;
  });
  return candidates.length > 0 ? candidates[candidates.length - 1]! : null;
}

export function findObservationByLogicalId(
  observations: EvidenceObservationRecord[],
  logicalObservationId: string,
): EvidenceObservationRecord | null {
  return observations.find((observation) => observation.logicalObservationId === logicalObservationId) ?? null;
}
