import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AwsAccountApiValidationError,
  validateDeleteAwsAccountBody,
  validateRegisterAwsAccountBody,
  validateUpdateAwsAccountBody,
  validateVerifyAwsAccountBody,
} from '../../api/aws-account-api-validation';

describe('validateRegisterAwsAccountBody', () => {
  it('accepts a valid registration body', () => {
    const result = validateRegisterAwsAccountBody({
      accountId: '111122223333',
      roleArn: 'arn:aws:iam::111122223333:role/SisumExecutionRole',
      region: 'us-east-1',
      metadata: { note: 'primary account' },
    });

    assert.equal(result.accountId, '111122223333');
    assert.equal(result.roleArn, 'arn:aws:iam::111122223333:role/SisumExecutionRole');
    assert.equal(result.region, 'us-east-1');
    assert.deepEqual(result.metadata, { note: 'primary account' });
  });

  it('rejects a non-12-digit accountId', () => {
    assert.throws(
      () =>
        validateRegisterAwsAccountBody({
          accountId: '123',
          roleArn: 'arn:aws:iam::123:role/Foo',
          region: 'us-east-1',
        }),
      AwsAccountApiValidationError,
    );
  });

  it('rejects a roleArn whose account number does not match accountId', () => {
    assert.throws(
      () =>
        validateRegisterAwsAccountBody({
          accountId: '111122223333',
          roleArn: 'arn:aws:iam::999988887777:role/SisumExecutionRole',
          region: 'us-east-1',
        }),
      AwsAccountApiValidationError,
    );
  });

  it('rejects an invalid region format', () => {
    assert.throws(
      () =>
        validateRegisterAwsAccountBody({
          accountId: '111122223333',
          roleArn: 'arn:aws:iam::111122223333:role/SisumExecutionRole',
          region: 'not-a-region',
        }),
      AwsAccountApiValidationError,
    );
  });

  it('rejects a client-supplied tenantId', () => {
    assert.throws(
      () =>
        validateRegisterAwsAccountBody({
          tenantId: 'attacker-tenant',
          accountId: '111122223333',
          roleArn: 'arn:aws:iam::111122223333:role/SisumExecutionRole',
          region: 'us-east-1',
        }),
      AwsAccountApiValidationError,
    );
  });

  it('rejects a client-supplied externalId (server-generated only)', () => {
    assert.throws(
      () =>
        validateRegisterAwsAccountBody({
          externalId: 'guessed-secret',
          accountId: '111122223333',
          roleArn: 'arn:aws:iam::111122223333:role/SisumExecutionRole',
          region: 'us-east-1',
        }),
      AwsAccountApiValidationError,
    );
  });

  it('rejects oversized metadata', () => {
    const bigMetadata: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) {
      bigMetadata[`key${i}`] = 'value';
    }

    assert.throws(
      () =>
        validateRegisterAwsAccountBody({
          accountId: '111122223333',
          roleArn: 'arn:aws:iam::111122223333:role/SisumExecutionRole',
          region: 'us-east-1',
          metadata: bigMetadata,
        }),
      AwsAccountApiValidationError,
    );
  });
});

describe('validateUpdateAwsAccountBody', () => {
  it('accepts region/metadata changes with expectedVersion', () => {
    const result = validateUpdateAwsAccountBody({
      region: 'eu-west-1',
      metadata: { note: 'updated' },
      expectedVersion: 2,
    });

    assert.equal(result.region, 'eu-west-1');
    assert.equal(result.expectedVersion, 2);
  });

  it('rejects attempts to change roleArn through this endpoint', () => {
    assert.throws(
      () =>
        validateUpdateAwsAccountBody({
          roleArn: 'arn:aws:iam::111122223333:role/NewRole',
          expectedVersion: 1,
        }),
      AwsAccountApiValidationError,
    );
  });

  it('requires a positive integer expectedVersion', () => {
    assert.throws(
      () => validateUpdateAwsAccountBody({ expectedVersion: 0 }),
      AwsAccountApiValidationError,
    );
    assert.throws(
      () => validateUpdateAwsAccountBody({}),
      AwsAccountApiValidationError,
    );
  });
});

describe('validateVerifyAwsAccountBody / validateDeleteAwsAccountBody', () => {
  it('requires expectedVersion', () => {
    assert.throws(() => validateVerifyAwsAccountBody({}), AwsAccountApiValidationError);
    assert.throws(() => validateDeleteAwsAccountBody({}), AwsAccountApiValidationError);
  });

  it('accepts a valid expectedVersion', () => {
    assert.equal(validateVerifyAwsAccountBody({ expectedVersion: 1 }).expectedVersion, 1);
    assert.equal(validateDeleteAwsAccountBody({ expectedVersion: 3 }).expectedVersion, 3);
  });
});
