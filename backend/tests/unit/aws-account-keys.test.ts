import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AWS_ACCOUNT_SK_PREFIX,
  awsAccountGlobalIndexPartitionKey,
  awsAccountLockPartitionKey,
  awsAccountSortKey,
  awsAccountStatusIndexPartitionKey,
  awsAccountStatusIndexSortKey,
  tenantPartitionKey,
} from '../../database';

describe('aws account DynamoDB keys', () => {
  it('maps tenant base-table keys', () => {
    assert.equal(tenantPartitionKey('tenant-a'), 'TENANT#tenant-a');
    assert.equal(awsAccountSortKey('123456789012'), 'AWS_ACCOUNT#123456789012');
    assert.equal(AWS_ACCOUNT_SK_PREFIX, 'AWS_ACCOUNT#');
  });

  it('maps gsi1 account lookup keys', () => {
    assert.equal(
      awsAccountGlobalIndexPartitionKey('123456789012'),
      'AWS_ACCOUNT#123456789012',
    );
  });

  it('maps gsi2 status listing keys', () => {
    assert.equal(
      awsAccountStatusIndexPartitionKey('tenant-a', 'PENDING'),
      'TENANT#tenant-a#AWS_ACCOUNT_STATUS#PENDING',
    );
    assert.equal(
      awsAccountStatusIndexSortKey(
        '2026-07-30T12:00:00.000Z',
        '123456789012',
      ),
      'UPDATED_AT#2026-07-30T12:00:00.000Z#AWS_ACCOUNT#123456789012',
    );
  });

  it('maps global uniqueness lock keys', () => {
    assert.equal(
      awsAccountLockPartitionKey('123456789012'),
      'AWS_ACCOUNT_LOCK#123456789012',
    );
  });
});
