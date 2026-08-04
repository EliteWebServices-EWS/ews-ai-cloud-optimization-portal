import {
  cloudResourceAccountPartitionKey,
  InvalidPaginationTokenError,
  type DynamoDbKey,
} from '../database';
import type { Ec2ResourceListQuery } from './contracts/ec2-cloud-resource-repository';
import {
  encodeScopedNextToken,
  type ScopedPaginationContext,
} from '../persistence/scoped-pagination-token';

/** Maximum opaque list token length (URL/query safety). */
export const EC2_CLOUD_RESOURCE_LIST_TOKEN_MAX_LENGTH = 2048;

export function buildEc2ResourceListPaginationScope(
  query: Pick<Ec2ResourceListQuery, 'tenantId' | 'accountId' | 'region' | 'resourceType'>,
): string {
  return [
    'ec2-cloud-resources',
    'v1',
    query.tenantId,
    query.accountId,
    query.region ?? '',
    query.resourceType ?? '',
  ].join(':');
}

function paginationContext(query: Ec2ResourceListQuery): ScopedPaginationContext {
  return {
    tenantId: query.tenantId,
    scope: buildEc2ResourceListPaginationScope(query),
  };
}

export function encodeEc2ResourceListNextToken(
  query: Ec2ResourceListQuery,
  lastEvaluatedKey?: DynamoDbKey,
): string | undefined {
  return encodeScopedNextToken(paginationContext(query), lastEvaluatedKey);
}

/**
 * Decodes a list nextToken for the given query. Tokens are bound to tenant,
 * account, and list filters (region / resourceType). Does not accept unscoped
 * legacy tokens.
 */
export function decodeEc2ResourceListNextToken(
  nextToken: string | undefined,
  query: Ec2ResourceListQuery,
): DynamoDbKey | undefined {
  if (!nextToken) {
    return undefined;
  }
  if (nextToken.length > EC2_CLOUD_RESOURCE_LIST_TOKEN_MAX_LENGTH) {
    throw new InvalidPaginationTokenError();
  }

  try {
    const serialized = Buffer.from(nextToken, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(serialized);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new InvalidPaginationTokenError();
    }

    const payload = parsed as {
      v?: number;
      tenantId?: string;
      scope?: string;
      key?: unknown;
    };

    const expected = paginationContext(query);
    if (
      payload.v !== 1 ||
      payload.tenantId !== expected.tenantId ||
      payload.scope !== expected.scope ||
      !payload.key ||
      typeof payload.key !== 'object' ||
      Array.isArray(payload.key)
    ) {
      throw new InvalidPaginationTokenError();
    }

    const key = payload.key as DynamoDbKey;
    const expectedPk = cloudResourceAccountPartitionKey(query.tenantId, query.accountId);
    if (String(key.pk) !== expectedPk) {
      throw new InvalidPaginationTokenError();
    }

    return key;
  } catch (error) {
    if (error instanceof InvalidPaginationTokenError) {
      throw error;
    }
    throw new InvalidPaginationTokenError();
  }
}

/** @internal Test helper — build a scoped token without going through DynamoDB. */
export function encodeEc2ResourceListNextTokenForTest(
  query: Ec2ResourceListQuery,
  exclusiveStartKey: DynamoDbKey,
): string {
  const token = encodeEc2ResourceListNextToken(query, exclusiveStartKey);
  if (!token) {
    throw new Error('expected token');
  }
  return token;
}

/** @internal Detect whether a token uses the scoped v1 envelope (vs raw key encoding). */
export function isScopedEc2ResourceListToken(nextToken: string): boolean {
  try {
    const parsed = JSON.parse(Buffer.from(nextToken, 'base64url').toString('utf8')) as {
      v?: number;
    };
    return parsed?.v === 1;
  } catch {
    return false;
  }
}
