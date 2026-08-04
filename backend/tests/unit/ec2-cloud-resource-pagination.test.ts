import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cloudResourceAccountPartitionKey,
  cloudResourceSortKey,
  encodeNextToken,
  InvalidPaginationTokenError,
} from '../../database';
import {
  buildEc2ResourceListPaginationScope,
  decodeEc2ResourceListNextToken,
  EC2_CLOUD_RESOURCE_LIST_TOKEN_MAX_LENGTH,
  encodeEc2ResourceListNextTokenForTest,
} from '../../repositories/ec2-cloud-resource-pagination';
import type { Ec2ResourceListQuery } from '../../repositories/contracts/ec2-cloud-resource-repository';

const baseQuery: Ec2ResourceListQuery = {
  tenantId: 'tenant-a',
  accountId: '111122223333',
};

function listKey(
  resourceId: string,
  region = 'us-east-1',
  resourceType: 'INSTANCE' | 'VOLUME' = 'INSTANCE',
) {
  return {
    pk: cloudResourceAccountPartitionKey(baseQuery.tenantId, baseQuery.accountId),
    sk: cloudResourceSortKey(region, resourceType, resourceId),
  };
}

describe('EC2 cloud resource list pagination tokens', () => {
  it('encodes and decodes a valid scoped token for the same query', () => {
    const token = encodeEc2ResourceListNextTokenForTest(baseQuery, listKey('i-1'));
    assert.deepEqual(decodeEc2ResourceListNextToken(token, baseQuery), listKey('i-1'));
  });

  it('rejects malformed base64', () => {
    assert.throws(
      () => decodeEc2ResourceListNextToken('%%%not-base64url%%%', baseQuery),
      InvalidPaginationTokenError,
    );
  });

  it('rejects base64 that decodes to invalid JSON', () => {
    const token = Buffer.from('not-json', 'utf8').toString('base64url');
    assert.throws(
      () => decodeEc2ResourceListNextToken(token, baseQuery),
      InvalidPaginationTokenError,
    );
  });

  it('rejects JSON missing required scoped fields', () => {
    const token = Buffer.from(JSON.stringify({ v: 1, tenantId: 'tenant-a' }), 'utf8').toString(
      'base64url',
    );
    assert.throws(
      () => decodeEc2ResourceListNextToken(token, baseQuery),
      InvalidPaginationTokenError,
    );
  });

  it('rejects token for another tenant', () => {
    const token = encodeEc2ResourceListNextTokenForTest(baseQuery, listKey('i-1'));
    assert.throws(
      () =>
        decodeEc2ResourceListNextToken(token, {
          ...baseQuery,
          tenantId: 'tenant-b',
        }),
      InvalidPaginationTokenError,
    );
  });

  it('rejects token for another AWS account', () => {
    const token = encodeEc2ResourceListNextTokenForTest(baseQuery, listKey('i-1'));
    assert.throws(
      () =>
        decodeEc2ResourceListNextToken(token, {
          ...baseQuery,
          accountId: '999988887777',
        }),
      InvalidPaginationTokenError,
    );
  });

  it('rejects token when list region filter scope differs', () => {
    const scopedQuery: Ec2ResourceListQuery = {
      ...baseQuery,
      region: 'us-west-2',
    };
    const token = encodeEc2ResourceListNextTokenForTest(scopedQuery, listKey('i-1', 'us-west-2'));
    assert.throws(
      () => decodeEc2ResourceListNextToken(token, { ...baseQuery, region: 'us-east-1' }),
      InvalidPaginationTokenError,
    );
  });

  it('rejects token when resourceType scope differs', () => {
    const scopedQuery: Ec2ResourceListQuery = {
      ...baseQuery,
      resourceType: 'VOLUME',
    };
    const token = encodeEc2ResourceListNextTokenForTest(
      scopedQuery,
      listKey('vol-1', 'us-east-1', 'VOLUME' as const),
    );
    assert.throws(
      () =>
        decodeEc2ResourceListNextToken(token, {
          ...baseQuery,
          resourceType: 'INSTANCE',
        }),
      InvalidPaginationTokenError,
    );
  });

  it('rejects oversized tokens', () => {
    const oversized = 'a'.repeat(EC2_CLOUD_RESOURCE_LIST_TOKEN_MAX_LENGTH + 1);
    assert.throws(
      () => decodeEc2ResourceListNextToken(oversized, baseQuery),
      InvalidPaginationTokenError,
    );
  });

  it('does not accept unscoped raw DynamoDB key tokens', () => {
    const raw = encodeNextToken(listKey('i-1'));
    assert.ok(raw);
    assert.throws(
      () => decodeEc2ResourceListNextToken(raw!, baseQuery),
      InvalidPaginationTokenError,
    );
  });

  it('does not surface decoder exception text to callers', () => {
    try {
      decodeEc2ResourceListNextToken('%%%', baseQuery);
    } catch (error) {
      assert.ok(error instanceof InvalidPaginationTokenError);
      assert.equal(error.message, 'The supplied pagination token is invalid.');
      assert.doesNotMatch(String(error), /SyntaxError/);
    }
  });

  it('buildEc2ResourceListPaginationScope binds tenant and account', () => {
    const scope = buildEc2ResourceListPaginationScope({
      tenantId: 't1',
      accountId: '111122223333',
      region: 'eu-west-1',
      resourceType: 'INSTANCE',
    });
    assert.match(scope, /t1/);
    assert.match(scope, /111122223333/);
    assert.match(scope, /eu-west-1/);
  });
});
