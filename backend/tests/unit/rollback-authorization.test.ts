import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateRollbackAuthorization,
  ROLLBACK_AUTHORIZATION_REASON,
  type EvaluateRollbackAuthorizationInput,
} from '../../rollback-authorization';
import { ACCOUNT_A, ACCOUNT_B, TENANT_A, TENANT_B } from '../fixtures/evidence/identities';

const FIXED_AT = '2026-08-21T12:00:00.000Z';

function baseInput(
  overrides: Partial<EvaluateRollbackAuthorizationInput> = {},
): EvaluateRollbackAuthorizationInput {
  return {
    evaluatedAt: FIXED_AT,
    executionId: 'exec-1',
    executionScope: { tenantId: TENANT_A, accountId: ACCOUNT_A },
    requestScope: { tenantId: TENANT_A, accountId: ACCOUNT_A },
    executionState: 'EXECUTED',
    alreadyRolledBack: false,
    verificationOutcome: 'ROLLBACK_CANDIDATE',
    rollbackEvidenceSufficient: true,
    requestedBy: {
      source: 'HUMAN_ACTOR',
      actorId: 'actor-owner',
      authorized: true,
      mfaVerified: true,
    },
    ...overrides,
  };
}

describe('Rollback authorization boundary (Task 5)', () => {
  it('authorizes a properly scoped, authorized, MFA-verified human actor request', () => {
    const decision = evaluateRollbackAuthorization(baseInput());
    assert.equal(decision.authorized, true);
    assert.equal(decision.authorizedByActorId, 'actor-owner');
    assert.equal(decision.authorizedAt, FIXED_AT);
    assert.ok(decision.reasonCodes.includes(ROLLBACK_AUTHORIZATION_REASON.AUTHORIZED_HUMAN_ACTOR));
  });

  it('ROLLBACK_CANDIDATE alone cannot execute rollback — denies when not flagged as a candidate', () => {
    const decision = evaluateRollbackAuthorization(baseInput({ verificationOutcome: 'HEALTHY' }));
    assert.equal(decision.authorized, false);
    assert.ok(
      decision.reasonCodes.includes(ROLLBACK_AUTHORIZATION_REASON.DENIED_NOT_ROLLBACK_CANDIDATE),
    );
  });

  it('denies when rollback evidence is not sufficient, even for a candidate', () => {
    const decision = evaluateRollbackAuthorization(
      baseInput({ rollbackEvidenceSufficient: false }),
    );
    assert.equal(decision.authorized, false);
    assert.ok(
      decision.reasonCodes.includes(ROLLBACK_AUTHORIZATION_REASON.DENIED_EVIDENCE_INSUFFICIENT),
    );
  });

  it('ML cannot authorize rollback', () => {
    const decision = evaluateRollbackAuthorization(
      baseInput({
        requestedBy: { source: 'ML', actorId: 'ml-model', authorized: true, mfaVerified: true },
      }),
    );
    assert.equal(decision.authorized, false);
    assert.equal(decision.authorizedByActorId, null);
    assert.ok(
      decision.reasonCodes.includes(ROLLBACK_AUTHORIZATION_REASON.DENIED_ML_CANNOT_AUTHORIZE),
    );
  });

  it('verification engine cannot invoke rollback directly', () => {
    const decision = evaluateRollbackAuthorization(
      baseInput({
        requestedBy: {
          source: 'VERIFICATION_ENGINE',
          actorId: 'verification-engine',
          authorized: true,
          mfaVerified: true,
        },
      }),
    );
    assert.equal(decision.authorized, false);
    assert.ok(
      decision.reasonCodes.includes(
        ROLLBACK_AUTHORIZATION_REASON.DENIED_VERIFICATION_CANNOT_INVOKE_DIRECTLY,
      ),
    );
  });

  it('privileged rollback preserves RBAC — denies an unauthorized role', () => {
    const decision = evaluateRollbackAuthorization(
      baseInput({
        requestedBy: {
          source: 'HUMAN_ACTOR',
          actorId: 'actor-analyst',
          authorized: false,
          mfaVerified: true,
        },
      }),
    );
    assert.equal(decision.authorized, false);
    assert.ok(
      decision.reasonCodes.includes(ROLLBACK_AUTHORIZATION_REASON.DENIED_ACTOR_UNAUTHORIZED),
    );
  });

  it('privileged rollback preserves MFA — denies a missing MFA claim', () => {
    const decision = evaluateRollbackAuthorization(
      baseInput({
        requestedBy: {
          source: 'HUMAN_ACTOR',
          actorId: 'actor-owner',
          authorized: true,
          mfaVerified: false,
        },
      }),
    );
    assert.equal(decision.authorized, false);
    assert.ok(decision.reasonCodes.includes(ROLLBACK_AUTHORIZATION_REASON.DENIED_MFA_REQUIRED));
  });

  it('cross-tenant rollback is denied', () => {
    const decision = evaluateRollbackAuthorization(
      baseInput({ requestScope: { tenantId: TENANT_B, accountId: ACCOUNT_B } }),
    );
    assert.equal(decision.authorized, false);
    assert.ok(decision.reasonCodes.includes(ROLLBACK_AUTHORIZATION_REASON.DENIED_CROSS_TENANT));
  });

  it('cross-account rollback within a different account is denied even if tenant matches', () => {
    const decision = evaluateRollbackAuthorization(
      baseInput({ requestScope: { tenantId: TENANT_A, accountId: ACCOUNT_B } }),
    );
    assert.equal(decision.authorized, false);
    assert.ok(decision.reasonCodes.includes(ROLLBACK_AUTHORIZATION_REASON.DENIED_CROSS_TENANT));
  });

  it('denies rollback on an execution not in a rollback-eligible state', () => {
    const decision = evaluateRollbackAuthorization(baseInput({ executionState: 'PENDING' }));
    assert.equal(decision.authorized, false);
    assert.ok(
      decision.reasonCodes.includes(
        ROLLBACK_AUTHORIZATION_REASON.DENIED_EXECUTION_NOT_ROLLBACK_ELIGIBLE_STATE,
      ),
    );
  });

  it('denies rollback that was already rolled back', () => {
    const decision = evaluateRollbackAuthorization(baseInput({ alreadyRolledBack: true }));
    assert.equal(decision.authorized, false);
    assert.ok(
      decision.reasonCodes.includes(ROLLBACK_AUTHORIZATION_REASON.DENIED_ALREADY_ROLLED_BACK),
    );
  });

  it('rollback authorization is attributable — denies an authorized+MFA-verified request with no actor id', () => {
    const decision = evaluateRollbackAuthorization(
      baseInput({
        requestedBy: { source: 'HUMAN_ACTOR', actorId: null, authorized: true, mfaVerified: true },
      }),
    );
    assert.equal(decision.authorized, false);
    assert.equal(decision.authorizedByActorId, null);
  });

  it('an authorized decision always carries both actor and timestamp attribution', () => {
    const decision = evaluateRollbackAuthorization(baseInput());
    if (decision.authorized) {
      assert.ok(decision.authorizedByActorId);
      assert.ok(decision.authorizedAt);
    }
  });
});
