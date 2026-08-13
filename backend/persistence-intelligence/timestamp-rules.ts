import { PersistenceDataQualityError } from './errors';

export interface ParsedObservationTimestamp {
  iso: string;
  epochMs: number;
}

export function parseObservationTimestamp(value: string | undefined | null): ParsedObservationTimestamp {
  if (value == null || value.trim() === '') {
    throw new PersistenceDataQualityError('Missing observation timestamp.');
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new PersistenceDataQualityError(`Invalid observation timestamp: ${value}`);
  }
  return { iso: new Date(parsed).toISOString(), epochMs: parsed };
}

export function parseOptionalTimestamp(value: string | undefined | null): ParsedObservationTimestamp | null {
  if (value == null || value.trim() === '') {
    return null;
  }
  return parseObservationTimestamp(value);
}

/** Normalize to millisecond precision ISO for deterministic ordering keys. */
export function normalizeObservationTimestampIso(value: string): string {
  return parseObservationTimestamp(value).iso;
}
