import {
  cloudResourceAccountPartitionKey,
  InvalidPaginationTokenError,
  type DynamoDbKey,
} from '../database';
import type { EvidenceObservationListQuery } from './contracts/evidence-observation-repository';
import {
  decodeScopedNextToken,
  encodeScopedNextToken,
  type ScopedPaginationContext,
} from '../persistence/scoped-pagination-token';

export const EVIDENCE_OBSERVATION_TOKEN_MAX_LENGTH = 2048;

export function buildEvidenceObservationListScope(
  query: Pick<EvidenceObservationListQuery, 'tenantId' | 'accountId' | 'findingKey'>,
): string {
  return ['evidence-observations', 'v1', query.tenantId, query.accountId, query.findingKey].join(':');
}

function paginationContext(query: EvidenceObservationListQuery): ScopedPaginationContext {
  return {
    tenantId: query.tenantId,
    scope: buildEvidenceObservationListScope(query),
  };
}

export function encodeEvidenceObservationNextToken(
  query: EvidenceObservationListQuery,
  lastEvaluatedKey?: DynamoDbKey,
): string | undefined {
  return encodeScopedNextToken(paginationContext(query), lastEvaluatedKey);
}

export function decodeEvidenceObservationNextToken(
  nextToken: string | undefined,
  query: EvidenceObservationListQuery,
): DynamoDbKey | undefined {
  if (!nextToken) {
    return undefined;
  }
  if (nextToken.length > EVIDENCE_OBSERVATION_TOKEN_MAX_LENGTH) {
    throw new InvalidPaginationTokenError();
  }
  const key = decodeScopedNextToken(nextToken, paginationContext(query));
  const expectedPk = cloudResourceAccountPartitionKey(query.tenantId, query.accountId);
  if (key && String(key.pk) !== expectedPk) {
    throw new InvalidPaginationTokenError();
  }
  return key;
}
