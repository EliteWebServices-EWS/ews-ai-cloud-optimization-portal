import { sortActionLogRecords } from '../action-log/event-ordering';
import type { ActionLogRecord } from '../action-log/types';

/**
 * Deduplicate by logicalEventId, preserving first canonical occurrence,
 * then deterministically order by domain event time.
 */
export function dedupeAndOrderActionLogRecords(
  records: readonly ActionLogRecord[],
): ActionLogRecord[] {
  const byLogicalId = new Map<string, ActionLogRecord>();
  for (const record of records) {
    if (!byLogicalId.has(record.logicalEventId)) {
      byLogicalId.set(record.logicalEventId, record);
    }
  }
  return sortActionLogRecords([...byLogicalId.values()]);
}
