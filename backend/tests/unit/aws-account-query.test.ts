import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyAwsAccountQuery,
  AwsAccountQueryValidationError,
  parseAwsAccountQuery,
} from '../../services/aws-account-query';
import type { AwsAccountRecord } from '../../repositories/models/aws-account-persistence-models';

function makeAccount(overrides: Partial<AwsAccountRecord>): AwsAccountRecord {
  const accountId = overrides.accountId ?? '111122223333';
  return {
    tenantId: 'tenant-a',
    accountId,
    roleArn: `arn:aws:iam::${accountId}:role/SisumExecutionRole`,
    externalId: 'ext-1',
    region: 'us-east-1',
    status: 'PENDING',
    verificationStatus: 'NOT_STARTED',
    metadata: {},
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('parseAwsAccountQuery', () => {
  it('parses filters, search, sort, and pagination', () => {
    const query = parseAwsAccountQuery({
      status: 'verified',
      region: 'us-east-1',
      search: '1111',
      sortBy: 'accountId',
      sortOrder: 'asc',
      limit: '10',
    });

    assert.equal(query.filters.status, 'VERIFIED');
    assert.equal(query.filters.region, 'us-east-1');
    assert.equal(query.search, '1111');
    assert.equal(query.sortBy, 'accountId');
    assert.equal(query.sortOrder, 'asc');
    assert.equal(query.limit, 10);
  });

  it('rejects an unsupported status filter', () => {
    assert.throws(
      () => parseAwsAccountQuery({ status: 'BOGUS' }),
      AwsAccountQueryValidationError,
    );
  });

  it('rejects an out-of-range limit', () => {
    assert.throws(
      () => parseAwsAccountQuery({ limit: '999' }),
      AwsAccountQueryValidationError,
    );
  });
});

describe('applyAwsAccountQuery', () => {
  const accounts = [
    makeAccount({
      accountId: '111100000000',
      status: 'VERIFIED',
      region: 'us-east-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    makeAccount({
      accountId: '222200000000',
      status: 'PENDING',
      region: 'eu-west-1',
      createdAt: '2026-01-02T00:00:00.000Z',
    }),
    makeAccount({
      accountId: '333300000000',
      status: 'VERIFIED',
      region: 'us-east-1',
      createdAt: '2026-01-03T00:00:00.000Z',
    }),
  ];

  it('filters by status', () => {
    const result = applyAwsAccountQuery(accounts, {
      filters: { status: 'VERIFIED' },
      sortBy: 'createdAt',
      sortOrder: 'desc',
      limit: 10,
    });

    assert.equal(result.total, 2);
    assert.deepEqual(
      result.accounts.map((a) => a.accountId),
      ['333300000000', '111100000000'],
    );
  });

  it('searches across accountId', () => {
    const result = applyAwsAccountQuery(accounts, {
      filters: {},
      search: '2222',
      sortBy: 'createdAt',
      sortOrder: 'desc',
      limit: 10,
    });

    assert.equal(result.total, 1);
    assert.equal(result.accounts[0].accountId, '222200000000');
  });

  it('paginates and returns a usable nextToken', () => {
    const firstPage = applyAwsAccountQuery(accounts, {
      filters: {},
      sortBy: 'createdAt',
      sortOrder: 'desc',
      limit: 2,
    });

    assert.equal(firstPage.accounts.length, 2);
    assert.ok(firstPage.nextToken);

    const secondPage = applyAwsAccountQuery(accounts, {
      filters: {},
      sortBy: 'createdAt',
      sortOrder: 'desc',
      limit: 2,
      nextToken: firstPage.nextToken,
    });

    assert.equal(secondPage.accounts.length, 1);
    assert.equal(secondPage.nextToken, undefined);
  });
});
