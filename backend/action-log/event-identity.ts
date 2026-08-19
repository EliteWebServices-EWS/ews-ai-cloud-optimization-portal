import { createHash } from 'node:crypto';

import { stableStringify } from '../persistence-intelligence/canonical-json';
import type { RecordActionLogEventInput } from './types';

export function buildActionLogOrderKey(input: {
  sourceStage: string;
  sourceRecordId: string;
  sourceRecordVersion?: string;
}): string {
  const version = input.sourceRecordVersion?.trim() || '0';
  return `${input.sourceStage}#${input.sourceRecordId}#${version}`;
}

/**
 * Deterministic logical identity for duplicate-sensitive ActionLog events.
 * Prefer caller-supplied {@link RecordActionLogEventInput.logicalEventId}.
 */
export function buildLogicalActionLogEventId(
  input: Pick<
    RecordActionLogEventInput,
    | 'tenantId'
    | 'accountId'
    | 'correlationId'
    | 'eventType'
    | 'sourceStage'
    | 'sourceRecordId'
    | 'sourceRecordVersion'
  >,
): string {
  return createHash('sha256')
    .update(
      stableStringify({
        tenantId: input.tenantId,
        accountId: input.accountId ?? null,
        correlationId: input.correlationId,
        eventType: input.eventType,
        sourceStage: input.sourceStage,
        sourceRecordId: input.sourceRecordId,
        sourceRecordVersion: input.sourceRecordVersion ?? null,
      }),
      'utf8',
    )
    .digest('hex');
}

export function resolveLogicalActionLogEventId(
  input: RecordActionLogEventInput,
): string {
  const supplied = input.logicalEventId?.trim();
  if (supplied) {
    return supplied;
  }
  return buildLogicalActionLogEventId(input);
}
