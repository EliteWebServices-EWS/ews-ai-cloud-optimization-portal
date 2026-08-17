import {
  cloudResourceAccountPartitionKey,
  InvalidPaginationTokenError,
  type DynamoDbKey,
} from '../database';
import type { EvidenceMaturityAssessmentListQuery } from './contracts/evidence-maturity-repository';
import {
  decodeScopedNextToken,
  encodeScopedNextToken,
  type ScopedPaginationContext,
} from '../persistence/scoped-pagination-token';

export const EVIDENCE_MATURITY_TOKEN_MAX_LENGTH = 2048;

export function buildEvidenceMaturityListScope(
  query: Pick<EvidenceMaturityAssessmentListQuery, 'tenantId' | 'accountId' | 'findingKey'>,
): string {
  return ['evidence-maturity', 'v1', query.tenantId, query.accountId, query.findingKey].join(':');
}

function paginationContext(query: EvidenceMaturityAssessmentListQuery): ScopedPaginationContext {
  return {
    tenantId: query.tenantId,
    scope: buildEvidenceMaturityListScope(query),
  };
}

export function encodeEvidenceMaturityNextToken(
  query: EvidenceMaturityAssessmentListQuery,
  lastEvaluatedKey?: DynamoDbKey,
): string | undefined {
  return encodeScopedNextToken(paginationContext(query), lastEvaluatedKey);
}

export function decodeEvidenceMaturityNextToken(
  nextToken: string | undefined,
  query: EvidenceMaturityAssessmentListQuery,
): DynamoDbKey | undefined {
  if (!nextToken) {
    return undefined;
  }
  if (nextToken.length > EVIDENCE_MATURITY_TOKEN_MAX_LENGTH) {
    throw new InvalidPaginationTokenError();
  }
  const key = decodeScopedNextToken(nextToken, paginationContext(query));
  const expectedPk = cloudResourceAccountPartitionKey(query.tenantId, query.accountId);
  if (key && String(key.pk) !== expectedPk) {
    throw new InvalidPaginationTokenError();
  }
  return key;
}
