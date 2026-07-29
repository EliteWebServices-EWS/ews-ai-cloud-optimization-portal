import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getAllowedExecutionTransitions,
  InvalidExecutionApprovalError,
  InvalidExecutionTransitionError,
  validateExecutionStartAllowed,
  validateExecutionTransition,
} from '../../services/execution-lifecycle';

import type { ExecutionPlanStatus } from '../../repositories/models';

const ALL_STATUSES: ExecutionPlanStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'ROLLED_BACK',
];

describe('validateExecutionTransition', () => {
  for (const current of ALL_STATUSES) {
    for (const next of ALL_STATUSES) {
      const allowed = getAllowedExecutionTransitions(current);
      const shouldAllow = allowed.includes(next);

      it(`${current} -> ${next} is ${shouldAllow ? 'allowed' : 'disallowed'}`, () => {
        if (shouldAllow) {
          const context =
            current === 'DRAFT' && next === 'APPROVED'
              ? {
                  approvalRequired: false,
                  approvalStatus: 'NOT_REQUIRED' as const,
                }
              : {
                  approvalRequired: true,
                  approvalStatus: 'PENDING' as const,
                };

          assert.doesNotThrow(() =>
            validateExecutionTransition(current, next, context),
          );
          return;
        }

        assert.throws(
          () => validateExecutionTransition(current, next),
          InvalidExecutionTransitionError,
        );
      });
    }
  }

  it('rejects idempotent same-state transitions', () => {
    assert.throws(
      () => validateExecutionTransition('DRAFT', 'DRAFT'),
      InvalidExecutionTransitionError,
    );
  });

  it('rejects DRAFT -> APPROVED when approval is required', () => {
    assert.throws(
      () =>
        validateExecutionTransition('DRAFT', 'APPROVED', {
          approvalRequired: true,
          approvalStatus: 'PENDING',
        }),
      InvalidExecutionTransitionError,
    );
  });
});

describe('validateExecutionStartAllowed', () => {
  it('blocks EXECUTING when approval is required but not granted', () => {
    assert.throws(
      () =>
        validateExecutionStartAllowed('EXECUTING', true, 'PENDING'),
      InvalidExecutionApprovalError,
    );
  });

  it('allows EXECUTING when approval is not required', () => {
    assert.doesNotThrow(() =>
      validateExecutionStartAllowed('EXECUTING', false, 'NOT_REQUIRED'),
    );
  });
});
