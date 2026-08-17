import { createHash } from 'node:crypto';

import { stableStringify } from '../persistence-intelligence/canonical-json';

import { parseObservationTimestamp } from './timestamp-rules';
import type { GovernanceEvidenceObservationRecord } from './types';

/**
 * Structurally mirrors persistence-intelligence/observation-ordering.ts
 * (Engineer 1's evidence-persistence ordering utilities) but is typed to
 * GovernanceEvidenceObservationRecord. Kept as a separate, domain-owned
 * module rather than genericizing Sprint 1's frozen types, so this Sprint 2
 * work cannot introduce a regression into that accepted contract.
 */
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
  observations: GovernanceEvidenceObservationRecord[],
): GovernanceEvidenceObservationRecord[] {
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
 * Late/out-of-order inserts are appended without rewriting prior rows and are
 * classified against their chronologically prior observation, never the
 * most-recently-written one.
 */
export function selectRelevantPreviousObservation(
  observations: GovernanceEvidenceObservationRecord[],
  currentObservationTimestamp: string,
  excludeLogicalObservationId?: string,
): GovernanceEvidenceObservationRecord | null {
  const currentMs = parseObservationTimestamp(currentObservationTimestamp).epochMs;
  const candidates = sortObservationsByObservationTimestamp(observations).filter((observation) => {
    if (
      excludeLogicalObservationId &&
      observation.logicalObservationId === excludeLogicalObservationId
    ) {
      return false;
    }
    const obsMs = parseObservationTimestamp(observation.observationTimestamp).epochMs;
    return obsMs < currentMs;
  });
  return candidates.length > 0 ? candidates[candidates.length - 1]! : null;
}

export function findObservationByLogicalId(
  observations: GovernanceEvidenceObservationRecord[],
  logicalObservationId: string,
): GovernanceEvidenceObservationRecord | null {
  return (
    observations.find((observation) => observation.logicalObservationId === logicalObservationId) ??
    null
  );
}

export interface LatestObservedControlOrderingFields {
  latestObservationTimestamp: string;
  latestLogicalObservationId: string;
}

/**
 * Canonical latest-checkpoint ordering: observationTimestamp ascending, then
 * logicalObservationId lexicographic. A candidate advances the checkpoint only
 * if it sorts strictly after the incumbent.
 */
export function compareLatestObservedControlOrdering(
  left: LatestObservedControlOrderingFields,
  right: LatestObservedControlOrderingFields,
): number {
  const leftMs = parseObservationTimestamp(left.latestObservationTimestamp).epochMs;
  const rightMs = parseObservationTimestamp(right.latestObservationTimestamp).epochMs;
  if (leftMs !== rightMs) {
    return leftMs - rightMs;
  }
  return left.latestLogicalObservationId.localeCompare(right.latestLogicalObservationId);
}

export function latestObservedControlCandidateShouldAdvance(
  candidate: LatestObservedControlOrderingFields,
  existing: LatestObservedControlOrderingFields,
): boolean {
  return compareLatestObservedControlOrdering(candidate, existing) > 0;
}
