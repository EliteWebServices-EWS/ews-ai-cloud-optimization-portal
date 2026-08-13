import { requireKeyValue, requireOpaqueKeyValue } from '../dynamodb-keys';

export const EVIDENCE_OBSERVATION_ENTITY = 'EVIDENCE_OBSERVATION' as const;
export const EVIDENCE_OBSERVATION_SK_PREFIX = `${EVIDENCE_OBSERVATION_ENTITY}#`;

export function evidenceObservationSortKey(input: {
  findingKey: string;
  observationTimestampIso: string;
  logicalObservationId: string;
}): string {
  return `${EVIDENCE_OBSERVATION_SK_PREFIX}FK#${requireKeyValue(
    input.findingKey,
    'findingKey',
  )}#TS#${requireKeyValue(input.observationTimestampIso, 'observationTimestampIso')}#LOG#${requireOpaqueKeyValue(
    input.logicalObservationId,
    'logicalObservationId',
  )}`;
}

export function evidenceObservationSortKeyPrefixForFinding(findingKey: string): string {
  return `${EVIDENCE_OBSERVATION_SK_PREFIX}FK#${requireKeyValue(findingKey, 'findingKey')}#`;
}
