import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AwsAccountStatus } from '../../repositories/models';

import {
  AWS_ACCOUNT_ALLOWED_TRANSITIONS,
  InvalidAwsAccountTransitionError,
  validateAwsAccountStatusConsistency,
  validateAwsAccountTransition,
  verificationFieldsForValidationFailure,
  verificationFieldsForValidationStart,
  verificationFieldsForValidationSuccess,
} from '../../services/aws-account-lifecycle';

const ALL_STATUSES: AwsAccountStatus[] = [
  'PENDING',
  'VALIDATING',
  'VERIFIED',
  'SUSPENDED',
  'DELETED',
];

describe('validateAwsAccountTransition', () => {
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      const allowed = AWS_ACCOUNT_ALLOWED_TRANSITIONS[from];
      const shouldAllow = from !== to && allowed.includes(to);

      it(`${from} -> ${to} is ${shouldAllow ? 'allowed' : 'blocked'}`, () => {
        if (shouldAllow) {
          assert.doesNotThrow(() => validateAwsAccountTransition(from, to));
          return;
        }

        assert.throws(
          () => validateAwsAccountTransition(from, to),
          InvalidAwsAccountTransitionError,
        );
      });
    }
  }

  it('treats DELETED as terminal', () => {
    assert.deepEqual(AWS_ACCOUNT_ALLOWED_TRANSITIONS.DELETED, []);
  });

  it('provides validation start fields', () => {
    assert.deepEqual(verificationFieldsForValidationStart(), {
      verificationStatus: 'IN_PROGRESS',
    });
  });

  it('provides validation success fields', () => {
    assert.deepEqual(
      verificationFieldsForValidationSuccess('2026-07-30T12:00:00.000Z'),
      {
        verificationStatus: 'SUCCEEDED',
        lastValidated: '2026-07-30T12:00:00.000Z',
      },
    );
  });

  it('provides validation failure fields', () => {
    assert.deepEqual(
      verificationFieldsForValidationFailure('2026-07-30T12:00:00.000Z'),
      {
        verificationStatus: 'FAILED',
        lastValidated: '2026-07-30T12:00:00.000Z',
      },
    );
  });

  it('allows PENDING with FAILED and lastValidated in consistency checks', () => {
    assert.doesNotThrow(() =>
      validateAwsAccountStatusConsistency({
        status: 'PENDING',
        verificationStatus: 'FAILED',
        lastValidated: '2026-07-30T12:00:00.000Z',
      }),
    );
  });

  it('allows VALIDATING with prior lastValidated while IN_PROGRESS', () => {
    assert.doesNotThrow(() =>
      validateAwsAccountStatusConsistency({
        status: 'VALIDATING',
        verificationStatus: 'IN_PROGRESS',
        lastValidated: '2026-07-30T12:00:00.000Z',
      }),
    );
  });
});
