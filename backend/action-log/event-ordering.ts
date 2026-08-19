import type { ActionLogRecord } from './types';

/**
 * Deterministic lifecycle ordering:
 * 1. occurredAt ascending (domain event time)
 * 2. orderKey ascending (source stage + record identity)
 * 3. logicalEventId ascending (final tie-break)
 *
 * recordedAt is intentionally excluded — late arrivals append without
 * retroactive reordering of domain time.
 */
export function compareActionLogRecords(
  left: ActionLogRecord,
  right: ActionLogRecord,
): number {
  const occurredCompare = left.occurredAt.localeCompare(right.occurredAt);
  if (occurredCompare !== 0) {
    return occurredCompare;
  }

  const orderCompare = left.orderKey.localeCompare(right.orderKey);
  if (orderCompare !== 0) {
    return orderCompare;
  }

  return left.logicalEventId.localeCompare(right.logicalEventId);
}

export function sortActionLogRecords(
  records: ActionLogRecord[],
): ActionLogRecord[] {
  return [...records].sort(compareActionLogRecords);
}
