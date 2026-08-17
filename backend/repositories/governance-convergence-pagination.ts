import {
  cloudResourceAccountPartitionKey,
  InvalidPaginationTokenError,
  type DynamoDbKey,
} from '../database';
import type { GovernanceConvergenceListQuery } from './contracts/governance-convergence-repository';
import {
  decodeScopedNextToken,
  encodeScopedNextToken,
  type ScopedPaginationContext,
} from '../persistence/scoped-pagination-token';

export const GOVERNANCE_CONVERGENCE_TOKEN_MAX_LENGTH = 2048;

export function buildGovernanceConvergenceListScope(
  query: Pick<GovernanceConvergenceListQuery, 'tenantId' | 'accountId' | 'findingKey'>,
): string {
  return ['governance-convergence-observations', 'v1', query.tenantId, query.accountId, query.findingKey].join(
    ':',
  );
}

function paginationContext(query: GovernanceConvergenceListQuery): ScopedPaginationContext {
  return {
    tenantId: query.tenantId,
    scope: buildGovernanceConvergenceListScope(query),
  };
}

export function encodeGovernanceConvergenceNextToken(
  query: GovernanceConvergenceListQuery,
  lastEvaluatedKey?: DynamoDbKey,
): string | undefined {
  return encodeScopedNextToken(paginationContext(query), lastEvaluatedKey);
}

export function decodeGovernanceConvergenceNextToken(
  nextToken: string | undefined,
  query: GovernanceConvergenceListQuery,
): DynamoDbKey | undefined {
  if (!nextToken) {
    return undefined;
  }
  if (nextToken.length > GOVERNANCE_CONVERGENCE_TOKEN_MAX_LENGTH) {
    throw new InvalidPaginationTokenError();
  }
  const key = decodeScopedNextToken(nextToken, paginationContext(query));
  const expectedPk = cloudResourceAccountPartitionKey(query.tenantId, query.accountId);
  if (key && String(key.pk) !== expectedPk) {
    throw new InvalidPaginationTokenError();
  }
  return key;
}
