import { randomUUID } from 'node:crypto';

/**
 * Builds a collision-resistant, lexicographically sortable append-only sort key
 * suffix: `<ISO timestamp>#<uuid>`.
 */
export function buildAppendOnlyKeySuffix(recordedAt?: string): string {
  const timestamp = recordedAt ?? new Date().toISOString();
  return `${timestamp}#${randomUUID()}`;
}

/**
 * Compares append-only history/confidence sort keys, supporting legacy numeric
 * sequence keys and newer timestamp#uuid keys under the same prefix.
 */
export function compareAppendOnlySortKeys(leftSk: string, rightSk: string): number {
  return leftSk.localeCompare(rightSk);
}
