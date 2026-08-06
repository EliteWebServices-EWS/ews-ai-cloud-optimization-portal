import {
  cloudResourceAccountPartitionKey,
  InvalidPaginationTokenError,
  type DynamoDbKey,
} from '../database';
import type { Ec2SecurityFindingListQuery } from './contracts/ec2-security-repository';
import {
  decodeScopedNextToken,
  encodeScopedNextToken,
  type ScopedPaginationContext,
} from '../persistence/scoped-pagination-token';

export const EC2_SECURITY_FINDING_TOKEN_MAX_LENGTH = 2048;

export function buildEc2SecurityFindingListScope(
  query: Pick<
    Ec2SecurityFindingListQuery,
    'tenantId' | 'accountId' | 'region' | 'severity' | 'category' | 'status' | 'resourceId'
  >,
): string {
  return [
    'ec2-security-findings',
    'v1',
    query.tenantId,
    query.accountId,
    query.region ?? '',
    query.severity ?? '',
    query.category ?? '',
    query.status ?? '',
    query.resourceId ?? '',
  ].join(':');
}

function paginationContext(query: Ec2SecurityFindingListQuery): ScopedPaginationContext {
  return {
    tenantId: query.tenantId,
    scope: buildEc2SecurityFindingListScope(query),
  };
}

export function encodeEc2SecurityFindingNextToken(
  query: Ec2SecurityFindingListQuery,
  lastEvaluatedKey?: DynamoDbKey,
): string | undefined {
  return encodeScopedNextToken(paginationContext(query), lastEvaluatedKey);
}

export function decodeEc2SecurityFindingNextToken(
  nextToken: string | undefined,
  query: Ec2SecurityFindingListQuery,
): DynamoDbKey | undefined {
  if (!nextToken) {
    return undefined;
  }
  if (nextToken.length > EC2_SECURITY_FINDING_TOKEN_MAX_LENGTH) {
    throw new InvalidPaginationTokenError();
  }
  const key = decodeScopedNextToken(nextToken, paginationContext(query));
  const expectedPk = cloudResourceAccountPartitionKey(query.tenantId, query.accountId);
  if (key && String(key.pk) !== expectedPk) {
    throw new InvalidPaginationTokenError();
  }
  return key;
}
