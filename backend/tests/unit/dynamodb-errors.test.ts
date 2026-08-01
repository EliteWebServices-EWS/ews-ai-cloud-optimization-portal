import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

import { isConditionalCheckFailure } from '../../database/dynamodb-errors';

describe('isConditionalCheckFailure', () => {
  it('returns true for ConditionalCheckFailedException', () => {
    const error = new Error('Conditional check failed');
    error.name = 'ConditionalCheckFailedException';

    assert.equal(isConditionalCheckFailure(error), true);
  });

  it('returns true for TransactionCanceledException with ConditionalCheckFailed', () => {
    const error = new TransactionCanceledException({
      message: 'Transaction cancelled',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
      $metadata: {},
    });

    assert.equal(isConditionalCheckFailure(error), true);
  });

  it('returns true when None precedes ConditionalCheckFailed in cancellation reasons', () => {
    const error = new TransactionCanceledException({
      message: 'Transaction cancelled',
      CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
      $metadata: {},
    });

    assert.equal(isConditionalCheckFailure(error), true);
  });

  it('returns false for TransactionCanceledException with TransactionConflict only', () => {
    const error = new TransactionCanceledException({
      message: 'Transaction cancelled',
      CancellationReasons: [{ Code: 'TransactionConflict' }],
      $metadata: {},
    });

    assert.equal(isConditionalCheckFailure(error), false);
  });

  it('returns false for TransactionCanceledException without cancellation reasons', () => {
    const error = new TransactionCanceledException({
      message: 'Transaction cancelled',
      $metadata: {},
    });

    assert.equal(isConditionalCheckFailure(error), false);
  });

  it('returns false for unrelated errors', () => {
    const error = new Error('Something else');
    error.name = 'InternalServerError';

    assert.equal(isConditionalCheckFailure(error), false);
  });

  it('returns false for non-Error values', () => {
    assert.equal(isConditionalCheckFailure(null), false);
    assert.equal(isConditionalCheckFailure('ConditionalCheckFailedException'), false);
    assert.equal(isConditionalCheckFailure({ name: 'ConditionalCheckFailedException' }), false);
  });
});
