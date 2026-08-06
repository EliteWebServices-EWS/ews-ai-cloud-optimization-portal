import {
  cloudResourceAccountPartitionKey,
  InvalidPaginationTokenError,
  type DynamoDbKey,
} from '../database';
import type { Ec2CostRecommendationListQuery } from './contracts/ec2-cost-repository';
import {
  decodeScopedNextToken,
  encodeScopedNextToken,
  type ScopedPaginationContext,
} from '../persistence/scoped-pagination-token';
export const EC2_COST_RECOMMENDATION_TOKEN_MAX_LENGTH = 2048;

export function buildEc2CostRecommendationListScope(
  query: Pick<
    Ec2CostRecommendationListQuery,
    'tenantId' | 'accountId' | 'region' | 'category' | 'lifecycleStatus'
  >,
): string {
  return [
    'ec2-cost-recommendations',
    'v1',
    query.tenantId,
    query.accountId,
    query.region ?? '',
    query.category ?? '',
    query.lifecycleStatus ?? '',
  ].join(':');
}

function paginationContext(query: Ec2CostRecommendationListQuery): ScopedPaginationContext {
  return {
    tenantId: query.tenantId,
    scope: buildEc2CostRecommendationListScope(query),
  };
}

export function encodeEc2CostRecommendationNextToken(
  query: Ec2CostRecommendationListQuery,
  lastEvaluatedKey?: DynamoDbKey,
): string | undefined {
  return encodeScopedNextToken(paginationContext(query), lastEvaluatedKey);
}

export function decodeEc2CostRecommendationNextToken(
  nextToken: string | undefined,
  query: Ec2CostRecommendationListQuery,
): DynamoDbKey | undefined {
  if (!nextToken) {
    return undefined;
  }
  if (nextToken.length > EC2_COST_RECOMMENDATION_TOKEN_MAX_LENGTH) {
    throw new InvalidPaginationTokenError();
  }
  const key = decodeScopedNextToken(nextToken, paginationContext(query));
  const expectedPk = cloudResourceAccountPartitionKey(query.tenantId, query.accountId);
  if (key && String(key.pk) !== expectedPk) {
    throw new InvalidPaginationTokenError();
  }
  return key;
}
