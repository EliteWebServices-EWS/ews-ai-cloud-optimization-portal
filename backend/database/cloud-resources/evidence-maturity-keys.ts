import { requireKeyValue, requireOpaqueKeyValue } from '../dynamodb-keys';

export const EVIDENCE_MATURITY_ASSESSMENT_ENTITY = 'EVIDENCE_MATURITY_ASSESSMENT' as const;
export const EVIDENCE_MATURITY_ASSESSMENT_SK_PREFIX =
  `${EVIDENCE_MATURITY_ASSESSMENT_ENTITY}#` as const;

/**
 * Chronological list order: source observation timestamp (normalized) sorts before OBS/MV tie-breakers.
 * Matches evidence-observation TS# convention for lexical chronological ordering.
 */
export function evidenceMaturityAssessmentSortKey(input: {
  findingKey: string;
  sourceObservationTimestampIso: string;
  sourceLogicalObservationId: string;
  modelVersion: string;
}): string {
  return `${EVIDENCE_MATURITY_ASSESSMENT_SK_PREFIX}FK#${requireOpaqueKeyValue(
    input.findingKey,
    'findingKey',
  )}#TS#${requireKeyValue(
    input.sourceObservationTimestampIso,
    'sourceObservationTimestampIso',
  )}#OBS#${requireOpaqueKeyValue(
    input.sourceLogicalObservationId,
    'sourceLogicalObservationId',
  )}#MV#${requireKeyValue(input.modelVersion, 'modelVersion')}`;
}

export function evidenceMaturityAssessmentSortKeyPrefixForFinding(findingKey: string): string {
  return `${EVIDENCE_MATURITY_ASSESSMENT_SK_PREFIX}FK#${requireOpaqueKeyValue(findingKey, 'findingKey')}#`;
}
