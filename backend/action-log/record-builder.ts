import {
  buildActionLogOrderKey,
  resolveLogicalActionLogEventId,
} from './event-identity';
import {
  toActionLogRecord,
  validateRecordActionLogEventInput,
  type ActionLogRecord,
  type RecordActionLogEventInput,
} from './types';

export function prepareActionLogRecord(
  input: RecordActionLogEventInput,
): ActionLogRecord {
  const validated = validateRecordActionLogEventInput(input);
  const logicalEventId = resolveLogicalActionLogEventId(validated);
  const orderKey = buildActionLogOrderKey(validated);
  const recordedAt = validated.recordedAt ?? new Date().toISOString();
  return toActionLogRecord({
    ...validated,
    logicalEventId,
    orderKey,
    recordedAt,
  });
}
