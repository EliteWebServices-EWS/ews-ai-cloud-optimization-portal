import { evaluateActionPolicyActorGate } from '../action-policy';
import { ROLLBACK_AUTHORIZATION_POLICY_VERSION } from './model-version';
import { ROLLBACK_AUTHORIZATION_REASON } from './reason-codes';
import {
  ROLLBACK_ELIGIBLE_EXECUTION_STATES,
  type EvaluateRollbackAuthorizationInput,
  type RollbackAuthorizationDecision,
} from './types';

function denied(
  input: EvaluateRollbackAuthorizationInput,
  reasonCodes: RollbackAuthorizationDecision['reasonCodes'],
): RollbackAuthorizationDecision {
  return {
    authorized: false,
    reasonCodes,
    policyVersion: ROLLBACK_AUTHORIZATION_POLICY_VERSION,
    evaluatedAt: input.evaluatedAt,
    executionId: input.executionId,
    authorizedByActorId: null,
    authorizedAt: null,
  };
}

/**
 * Task 5 — independently governed rollback authorization boundary.
 *
 * A ROLLBACK_CANDIDATE verification outcome is advisory only and can never
 * by itself authorize a rollback (adr-int-08). This function is the single
 * gate a caller must pass before invoking rollback execution. It:
 *
 *   - refuses to authorize anything ML or the verification engine requests
 *     directly (only a HUMAN_ACTOR request can be authorized),
 *   - requires the same RBAC + privileged-MFA actor gate as any other
 *     privileged execution action (delegates to action-policy's shared
 *     actor gate rather than re-implementing it),
 *   - denies cross-tenant/cross-account requests outright,
 *   - denies rollback on executions that are not in a rollback-eligible
 *     terminal state, or that have already been rolled back,
 *   - always returns an attributable actor + timestamp when authorized.
 */
export function evaluateRollbackAuthorization(
  input: EvaluateRollbackAuthorizationInput,
): RollbackAuthorizationDecision {
  if (
    input.requestScope.tenantId !== input.executionScope.tenantId ||
    input.requestScope.accountId !== input.executionScope.accountId
  ) {
    return denied(input, [ROLLBACK_AUTHORIZATION_REASON.DENIED_CROSS_TENANT]);
  }

  if (input.requestedBy.source === 'ML') {
    return denied(input, [ROLLBACK_AUTHORIZATION_REASON.DENIED_ML_CANNOT_AUTHORIZE]);
  }

  if (input.requestedBy.source === 'VERIFICATION_ENGINE') {
    return denied(input, [
      ROLLBACK_AUTHORIZATION_REASON.DENIED_VERIFICATION_CANNOT_INVOKE_DIRECTLY,
    ]);
  }

  if (input.alreadyRolledBack) {
    return denied(input, [ROLLBACK_AUTHORIZATION_REASON.DENIED_ALREADY_ROLLED_BACK]);
  }

  if (
    !ROLLBACK_ELIGIBLE_EXECUTION_STATES.includes(
      input.executionState as (typeof ROLLBACK_ELIGIBLE_EXECUTION_STATES)[number],
    )
  ) {
    return denied(input, [
      ROLLBACK_AUTHORIZATION_REASON.DENIED_EXECUTION_NOT_ROLLBACK_ELIGIBLE_STATE,
    ]);
  }

  if (input.verificationOutcome !== 'ROLLBACK_CANDIDATE') {
    return denied(input, [ROLLBACK_AUTHORIZATION_REASON.DENIED_NOT_ROLLBACK_CANDIDATE]);
  }

  if (input.rollbackEvidenceSufficient !== true) {
    return denied(input, [ROLLBACK_AUTHORIZATION_REASON.DENIED_EVIDENCE_INSUFFICIENT]);
  }

  const actorGate = evaluateActionPolicyActorGate({
    authorized: input.requestedBy.authorized,
    mfaVerified: input.requestedBy.mfaVerified,
    privilegedActionRequired: true,
  });

  if (!actorGate.permitted) {
    if (!input.requestedBy.authorized) {
      return denied(input, [ROLLBACK_AUTHORIZATION_REASON.DENIED_ACTOR_UNAUTHORIZED]);
    }
    return denied(input, [ROLLBACK_AUTHORIZATION_REASON.DENIED_MFA_REQUIRED]);
  }

  if (!input.requestedBy.actorId) {
    return denied(input, [ROLLBACK_AUTHORIZATION_REASON.DENIED_ACTOR_UNAUTHORIZED]);
  }

  return {
    authorized: true,
    reasonCodes: [ROLLBACK_AUTHORIZATION_REASON.AUTHORIZED_HUMAN_ACTOR],
    policyVersion: ROLLBACK_AUTHORIZATION_POLICY_VERSION,
    evaluatedAt: input.evaluatedAt,
    executionId: input.executionId,
    authorizedByActorId: input.requestedBy.actorId,
    authorizedAt: input.evaluatedAt,
  };
}
