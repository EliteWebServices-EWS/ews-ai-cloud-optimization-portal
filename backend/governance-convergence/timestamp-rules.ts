import { GovernanceConvergenceDataQualityError } from './errors';

export interface ParsedObservationTimestamp {
  iso: string;
  epochMs: number;
}

export function parseObservationTimestamp(
  value: string | undefined | null,
): ParsedObservationTimestamp {
  if (value == null || value.trim() === '') {
    throw new GovernanceConvergenceDataQualityError('Missing observation timestamp.');
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new GovernanceConvergenceDataQualityError(`Invalid observation timestamp: ${value}`);
  }
  return { iso: new Date(parsed).toISOString(), epochMs: parsed };
}

/** Normalize to millisecond precision ISO for deterministic ordering keys. */
export function normalizeObservationTimestampIso(value: string): string {
  return parseObservationTimestamp(value).iso;
}
