import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InvalidAwsAccountRecordError,
  validateAwsAccountShape,
} from '../../repositories/models/aws-account-persistence-models';

function validInput() {
  return {
    accountId: '123456789012',
    tenantId: 'tenant-a',
    roleArn: 'arn:aws:iam::123456789012:role/SisumOnboardingRole',
    externalId: 'customer-external-id',
    region: 'eu-central-1',
    status: 'PENDING' as const,
    verificationStatus: 'NOT_STARTED' as const,
    metadata: { source: 'test' },
  };
}

describe('validateAwsAccountShape', () => {
  it('accepts a valid record', () => {
    const record = validateAwsAccountShape(validInput());
    assert.equal(record.accountId, '123456789012');
    assert.equal(record.version, 1);
  });

  it('rejects malformed account ID', () => {
    assert.throws(
      () =>
        validateAwsAccountShape({
          ...validInput(),
          accountId: '123',
        }),
      InvalidAwsAccountRecordError,
    );
  });

  it('rejects malformed role ARN', () => {
    assert.throws(
      () =>
        validateAwsAccountShape({
          ...validInput(),
          roleArn: 'not-an-arn',
        }),
      InvalidAwsAccountRecordError,
    );
  });

  it('rejects role ARN account mismatch', () => {
    assert.throws(
      () =>
        validateAwsAccountShape({
          ...validInput(),
          roleArn: 'arn:aws:iam::999999999999:role/OtherRole',
        }),
      InvalidAwsAccountRecordError,
    );
  });

  it('rejects missing external ID', () => {
    assert.throws(
      () =>
        validateAwsAccountShape({
          ...validInput(),
          externalId: '   ',
        }),
      InvalidAwsAccountRecordError,
    );
  });

  it('rejects invalid region', () => {
    assert.throws(
      () =>
        validateAwsAccountShape({
          ...validInput(),
          region: 'invalid',
        }),
      InvalidAwsAccountRecordError,
    );
  });

  it('rejects invalid timestamps', () => {
    assert.throws(
      () =>
        validateAwsAccountShape({
          ...validInput(),
          createdAt: 'not-a-date',
        }),
      InvalidAwsAccountRecordError,
    );
  });

  it('rejects invalid version', () => {
    assert.throws(
      () =>
        validateAwsAccountShape({
          ...validInput(),
          version: 0,
        }),
      InvalidAwsAccountRecordError,
    );
  });

  it('rejects invalid status and verification combinations', () => {
    assert.throws(
      () =>
        validateAwsAccountShape({
          ...validInput(),
          status: 'VERIFIED',
          verificationStatus: 'NOT_STARTED',
        }),
      InvalidAwsAccountRecordError,
    );
  });
});
