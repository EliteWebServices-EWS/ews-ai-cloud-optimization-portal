import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareVerificationOutcome } from '../../engines/verification/verification.comparator';
import { DEFAULT_VERIFICATION_CONFIG } from '../../engines/verification/verification.config';
import { VERIFICATION_STATUS } from '../../shared/constants';
import {
  buildCompletedExecutionResult,
  buildFailedExecutionResult,
  buildPendingExecutionResult,
  buildSkippedExecutionResult,
  buildVerificationExpectation,
} from '../fixtures/sprint-3-lifecycle/sprint-3-lifecycle-fixtures';
import {
  buildPostActionDegradationObservation,
  buildPostActionSuccessObservation,
} from '../fixtures/evidence/lifecycle-fixtures';

describe('Verification comparator legacy regression', () => {
  const expectation = buildVerificationExpectation();
  const config = DEFAULT_VERIFICATION_CONFIG;

  it('COMPLETED + state mismatch != VERIFIED', () => {
    const result = compareVerificationOutcome({
      executionResult: buildCompletedExecutionResult({
        change: {
          action: 'RESIZE_INSTANCE',
          from: 't3.medium',
          to: 't3.medium',
          resourceType: 'EC2',
        },
      }),
      observation: buildPostActionSuccessObservation(),
      expectation,
      config,
    });

    assert.notEqual(result.status, VERIFICATION_STATUS.VERIFIED);
    assert.equal(result.stateMatched, false);
  });

  it('COMPLETED + insufficient savings != VERIFIED', () => {
    const result = compareVerificationOutcome({
      executionResult: buildCompletedExecutionResult(),
      observation: buildPostActionDegradationObservation(),
      expectation,
      config,
    });

    assert.notEqual(result.status, VERIFICATION_STATUS.VERIFIED);
  });

  it('FAILED execution != VERIFIED', () => {
    const result = compareVerificationOutcome({
      executionResult: buildFailedExecutionResult(),
      observation: buildPostActionSuccessObservation(),
      expectation,
      config,
    });

    assert.equal(result.status, VERIFICATION_STATUS.FAILED);
    assert.notEqual(result.status, VERIFICATION_STATUS.VERIFIED);
  });

  it('PENDING execution != VERIFIED', () => {
    const result = compareVerificationOutcome({
      executionResult: buildPendingExecutionResult(),
      observation: buildPostActionSuccessObservation(),
      expectation,
      config,
    });

    assert.equal(result.status, VERIFICATION_STATUS.PENDING);
    assert.notEqual(result.status, VERIFICATION_STATUS.VERIFIED);
  });

  it('SKIPPED execution != VERIFIED', () => {
    const result = compareVerificationOutcome({
      executionResult: buildSkippedExecutionResult(),
      observation: buildPostActionSuccessObservation(),
      expectation,
      config,
    });

    assert.equal(result.status, VERIFICATION_STATUS.PENDING);
    assert.notEqual(result.status, VERIFICATION_STATUS.VERIFIED);
  });

  it('COMPLETED + matched state and savings == VERIFIED', () => {
    const result = compareVerificationOutcome({
      executionResult: buildCompletedExecutionResult(),
      observation: buildPostActionSuccessObservation(),
      expectation,
      config,
    });

    assert.equal(result.status, VERIFICATION_STATUS.VERIFIED);
    assert.equal(result.stateMatched, true);
  });
});
