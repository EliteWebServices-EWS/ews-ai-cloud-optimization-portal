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

export interface GovernanceObservationOrderingFields {
  observationTimestamp: string;
  analysisRunStartedAt: string;
  logicalObservationId: string;
}

/** Legacy rows without analysisRunStartedAt use observationTimestamp for ordering. */
export function resolveAnalysisRunStartedAtForOrdering(input: {
  observationTimestamp: string;
  analysisRunStartedAt?: string;
}): string {
  return input.analysisRunStartedAt ?? input.observationTimestamp;
}

function observationOrderingFields(
  observation: GovernanceEvidenceObservationRecord,
): GovernanceObservationOrderingFields {
  return {
    observationTimestamp: observation.observationTimestamp,
    analysisRunStartedAt: resolveAnalysisRunStartedAtForOrdering(observation),
    logicalObservationId: observation.logicalObservationId,
  };
}

/**
 * Canonical governance observation total order:
 * observationTimestamp, then analysisRunStartedAt, then logicalObservationId.
 */
export function compareGovernanceObservationOrdering(
  left: GovernanceObservationOrderingFields,
  right: GovernanceObservationOrderingFields,
): number {
  const leftMs = parseObservationTimestamp(left.observationTimestamp).epochMs;
  const rightMs = parseObservationTimestamp(right.observationTimestamp).epochMs;
  if (leftMs !== rightMs) {
    return leftMs - rightMs;
  }

  const leftStartMs = parseObservationTimestamp(left.analysisRunStartedAt).epochMs;
  const rightStartMs = parseObservationTimestamp(right.analysisRunStartedAt).epochMs;
  if (leftStartMs !== rightStartMs) {
    return leftStartMs - rightStartMs;
  }

  return left.logicalObservationId.localeCompare(right.logicalObservationId);
}

export function sortObservationsByObservationTimestamp(
  observations: GovernanceEvidenceObservationRecord[],
): GovernanceEvidenceObservationRecord[] {
  return [...observations].sort((left, right) =>
    compareGovernanceObservationOrdering(
      observationOrderingFields(left),
      observationOrderingFields(right),
    ),
  );
}

/**
 * Historical ordering authority: canonical total order above.
 * Relevant previous observation = latest persisted record strictly before the
 * current key among observations already stored at assessment time.
 * Assessment is append-only: results are not retroactively rewritten when an
 * older observation arrives later (arrival-time assessment, Model A).
 */
export function selectRelevantPreviousObservation(
  observations: GovernanceEvidenceObservationRecord[],
  current: GovernanceObservationOrderingFields,
  excludeLogicalObservationId?: string,
): GovernanceEvidenceObservationRecord | null {
  const candidates = sortObservationsByObservationTimestamp(observations).filter((observation) => {
    if (
      excludeLogicalObservationId &&
      observation.logicalObservationId === excludeLogicalObservationId
    ) {
      return false;
    }
    return (
      compareGovernanceObservationOrdering(observationOrderingFields(observation), current) < 0
    );
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
