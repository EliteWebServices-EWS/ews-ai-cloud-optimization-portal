import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InvalidPaginationTokenError, cloudResourceAccountPartitionKey } from '../../database';
import {
  buildEc2SecurityFindingListScope,
  decodeEc2SecurityFindingNextToken,
  encodeEc2SecurityFindingNextToken,
  EC2_SECURITY_FINDING_TOKEN_MAX_LENGTH,
} from '../../repositories/ec2-security-finding-pagination';
import { MockEc2SecurityRepository } from '../../repositories/mock/mock-ec2-security-repository';
import { EC2_SECURITY_RULE_VERSION } from '../../database/cloud-resources/ec2-security-keys';

describe('ec2-security-finding-pagination', () => {
  const baseQuery = {
    tenantId: 'tenant-a',
    accountId: '111122223333',
    region: 'us-east-1',
    status: 'OPEN',
  };

  it('builds deterministic scoped tokens and rejects cross-tenant/account scope', () => {
    const scope = buildEc2SecurityFindingListScope(baseQuery);
    assert.match(scope, /tenant-a/);
    const token = encodeEc2SecurityFindingNextToken(baseQuery, {
      pk: cloudResourceAccountPartitionKey(baseQuery.tenantId, baseQuery.accountId),
      sk: 'EC2_SECURITY_FINDING#us-east-1#RES#i-1#CHK#public_ip#RV#1',
    });
    assert.ok(token);
    const key = decodeEc2SecurityFindingNextToken(token, baseQuery);
    assert.ok(key?.sk);

    assert.throws(
      () =>
        decodeEc2SecurityFindingNextToken(token, {
          ...baseQuery,
          tenantId: 'tenant-b',
        }),
      InvalidPaginationTokenError,
    );
    assert.throws(
      () =>
        decodeEc2SecurityFindingNextToken(token, {
          ...baseQuery,
          accountId: '999988887777',
        }),
      InvalidPaginationTokenError,
    );
    assert.throws(
      () =>
        decodeEc2SecurityFindingNextToken(token, {
          ...baseQuery,
          region: 'eu-west-1',
        }),
      InvalidPaginationTokenError,
    );
  });

  it('rejects malformed and oversized tokens', () => {
    assert.throws(
      () => decodeEc2SecurityFindingNextToken('not-valid', baseQuery),
      InvalidPaginationTokenError,
    );
    assert.throws(
      () =>
        decodeEc2SecurityFindingNextToken('a'.repeat(EC2_SECURITY_FINDING_TOKEN_MAX_LENGTH + 1), baseQuery),
      InvalidPaginationTokenError,
    );
  });

  it('returns next page without duplicates from mock repository', async () => {
    const repo = new MockEc2SecurityRepository();
    for (let i = 0; i < 5; i += 1) {
      repo.seedFinding({
        findingId: `finding-${i}`,
        findingKey: `tenant-a#111122223333#us-east-1#i-${i}#public_ip#${EC2_SECURITY_RULE_VERSION}`,
        tenantId: 'tenant-a',
        accountId: '111122223333',
        region: 'us-east-1',
        resourceId: `i-${i}`,
        resourceType: 'INSTANCE',
        category: 'security',
        check: 'public_ip',
        ruleVersion: EC2_SECURITY_RULE_VERSION,
        severity: 'medium',
        status: 'OPEN',
        message: 'msg',
        recommendation: 'rec',
        analysisRunId: 'run-1',
        firstDetectedAt: '2026-01-01T00:00:00.000Z',
        lastDetectedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    }
    const page1 = await repo.listFindings({ ...baseQuery, limit: 2 });
    assert.equal(page1.items.length, 2);
    assert.ok(page1.nextToken);
    const page2 = await repo.listFindings({ ...baseQuery, limit: 2, nextToken: page1.nextToken });
    assert.equal(page2.items.length, 2);
    const ids = new Set([...page1.items, ...page2.items].map((item) => item.findingId));
    assert.equal(ids.size, 4);
  });
});
