import { randomUUID } from 'node:crypto';

/*
 * Process-monotonic clock. Guarantees strictly increasing key components for
 * sequential calls — even several within the same millisecond — so append-only
 * history preserves insertion order (e.g. created before updated). A plain
 * millisecond timestamp is not enough: two sequential appends can land in the
 * same millisecond, after which ordering would fall to the random UUID.
 */
let lastMillis = 0;
let intraMillisSequence = 0;

function nextMonotonicComponents(): {
  isoTimestamp: string;
  sequence: number;
} {
  const now = Date.now();

  if (now > lastMillis) {
    lastMillis = now;
    intraMillisSequence = 0;
  } else {
    // Same millisecond (or a clock that did not advance): keep time monotonic
    // and disambiguate with an incrementing intra-millisecond sequence.
    intraMillisSequence += 1;
  }

  return {
    isoTimestamp: new Date(lastMillis).toISOString(),
    sequence: intraMillisSequence,
  };
}

/**
 * Builds a collision-resistant, lexicographically sortable append-only sort key
 * suffix: `<ISO timestamp>#<intra-ms sequence>#<uuid>`.
 *
 * The intra-millisecond sequence makes ordering deterministic for appends that
 * share a millisecond, while the UUID keeps keys unique (collision-free) under
 * concurrent appends. The `recordedAt` argument is retained for call-site
 * compatibility; ordering is driven by the process-monotonic clock.
 */
export function buildAppendOnlyKeySuffix(_recordedAt?: string): string {
  const { isoTimestamp, sequence } = nextMonotonicComponents();
  return `${isoTimestamp}#${String(sequence).padStart(9, '0')}#${randomUUID()}`;
}

/**
 * Compares append-only history/confidence sort keys, supporting legacy numeric
 * sequence keys and newer timestamp#uuid keys under the same prefix.
 */
export function compareAppendOnlySortKeys(leftSk: string, rightSk: string): number {
  return leftSk.localeCompare(rightSk);
}
