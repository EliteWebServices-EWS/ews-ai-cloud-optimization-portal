import type { ActionLogRecord } from '../action-log/types';
import type { MlProvenanceSummary } from './types';

const ML_OUTCOME_EVENT_TYPES = new Set([
  'ML_EXECUTED',
  'ML_SKIPPED',
  'ML_FAILED_SAFE',
]);

export function extractMlProvenance(
  events: readonly ActionLogRecord[],
): MlProvenanceSummary | null {
  const eligibility = events.find(
    (event) => event.eventType === 'ML_ELIGIBILITY_EVALUATED',
  );
  const outcome = events.find((event) => ML_OUTCOME_EVENT_TYPES.has(event.eventType));

  if (!eligibility && !outcome) {
    return null;
  }

  const evaluationId =
    outcome?.sourceRecordId ?? eligibility?.sourceRecordId ?? '';
  const outcomeReasonCodes = outcome?.reasonCodes ?? [];
  const eligibilityReasonCodes = eligibility?.reasonCodes ?? [];

  return {
    evaluationId,
    modelId: outcome?.modelId,
    modelVersion: outcome?.sourceRecordVersion,
    featureSchemaVersion: outcome?.featureSchemaVersion,
    eligibilityPolicyVersion: eligibility?.sourceRecordVersion,
    eligibility: eligibilityReasonCodes[0],
    outcome: outcomeReasonCodes[0] ?? outcome?.eventType,
    fallback: outcomeReasonCodes[1],
    reasonCodes: [
      ...new Set([...eligibilityReasonCodes, ...outcomeReasonCodes]),
    ],
    evaluatedAt: eligibility?.occurredAt,
    inferredAt: outcome?.occurredAt,
  };
}
