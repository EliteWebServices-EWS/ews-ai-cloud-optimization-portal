import { randomUUID } from 'node:crypto';

/**
 * Builds a collision-resistant, lexicographically sortable append-only sort key
 * suffix.
 *
 * Without discriminator: `<ISO timestamp>#<uuid>`
 * With discriminator: `<ISO timestamp>#<discriminator>#<uuid>`
 */
export function buildAppendOnlyKeySuffix(
  recordedAt?: string,
  discriminator?: string,
): string {
  const timestamp = recordedAt ?? new Date().toISOString();

  if (discriminator !== undefined) {
    const normalized = discriminator.trim();
    if (!normalized) {
      throw new Error('Append-only key discriminator must be non-empty when provided.');
    }
    if (normalized.includes('#')) {
      throw new Error('Append-only key discriminator must not contain "#".');
    }
    return `${timestamp}#${normalized}#${randomUUID()}`;
  }

  return `${timestamp}#${randomUUID()}`;
}

/** Append-only suffix after the resource-specific `#<resourceId>#` prefix. */
export function extractAppendOnlySuffix(sortKey: string): string {
  const parts = sortKey.split('#');
  if (parts.length < 3) {
    return sortKey;
  }

  return parts.slice(2).join('#');
}

function compareAppendOnlySuffixes(leftSuffix: string, rightSuffix: string): number {
  const leftLegacy = /^\d+$/.test(leftSuffix);
  const rightLegacy = /^\d+$/.test(rightSuffix);

  if (leftLegacy && rightLegacy) {
    return Number(leftSuffix) - Number(rightSuffix);
  }

  const leftParts = leftSuffix.split('#');
  const rightParts = rightSuffix.split('#');

  const leftTimestamp = leftParts[0] ?? '';
  const rightTimestamp = rightParts[0] ?? '';
  const timestampCompare = leftTimestamp.localeCompare(rightTimestamp);
  if (timestampCompare !== 0) {
    return timestampCompare;
  }

  if (leftParts.length === 3 && rightParts.length === 3) {
    const orderCompare = leftParts[1]!.localeCompare(rightParts[1]!);
    if (orderCompare !== 0) {
      return orderCompare;
    }
    return leftParts[2]!.localeCompare(rightParts[2]!);
  }

  if (leftParts.length === 2 && rightParts.length === 2) {
    return leftParts[1]!.localeCompare(rightParts[1]!);
  }

  return leftSuffix.localeCompare(rightSuffix);
}

/**
 * Compares append-only history/confidence sort keys, supporting legacy numeric
 * sequence keys, timestamp#uuid keys, and timestamp#event-order#uuid keys under
 * the same resource prefix.
 */
export function compareAppendOnlySortKeys(leftSk: string, rightSk: string): number {
  if (leftSk === rightSk) {
    return 0;
  }

  const leftSuffix = extractAppendOnlySuffix(leftSk);
  const rightSuffix = extractAppendOnlySuffix(rightSk);

  const suffixCompare = compareAppendOnlySuffixes(leftSuffix, rightSuffix);
  if (suffixCompare !== 0) {
    return suffixCompare;
  }

  return leftSk.localeCompare(rightSk);
}
