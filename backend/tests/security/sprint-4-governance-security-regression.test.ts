import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canPerformExecutionPrivilegedAction } from '../../auth/execution-api-authorization';
import type { AuthenticatedIdentity } from '../../auth/identity';
import { evaluatePrivilegedMfa, PRIVILEGED_OPERATIONS } from '../../auth/privileged-mfa';
import type { RequestSecurityContext } from '../../auth/request-security-context';
import { TENANT_ROLES } from '../../auth/tenant-roles';
import { evaluateActionPolicyActorGate, ACTION_POLICY_REASON } from '../../action-policy';
import { detectContradictions, GOVERNANCE_REGRESSION_REASON } from '../../governance-regression-eng2';
import {
  evaluateRollbackAuthorization,
  ROLLBACK_AUTHORIZATION_REASON,
} from '../../rollback-authorization';
import { ACCOUNT_A, ACCOUNT_B, TENANT_A, TENANT_B } from '../fixtures/evidence/identities';
import { buildSafeBaselineSnapshot } from '../fixtures/sprint-4-governance-regression-eng2-alt/regression-matrix-fixtures';

const FIXED_AT = '2026-08-21T12:00:00.000Z';

function securityContext(overrides: Partial<RequestSecurityContext> = {}): RequestSecurityContext {
  return {
    tenantId: TENANT_A,
    requestId: 'req-sec-1',
    correlationId: 'corr-sec-1',
    roles: ['admin'],
    userId: 'owner-1',
    email: 'owner-1@example.com',
    claimPresent: true,
    usedFallback: false,
    invalidClaim: false,
    ...overrides,
  };
}

function identity(overrides: Partial<AuthenticatedIdentity> = {}): AuthenticatedIdentity {
  return {
    authenticated: true,
    userId: 'owner-1',
    email: 'owner-1@example.com',
    groups: ['admin'],
    rawGroups: ['admin'],
    tokenUse: 'access',
    clientId: 'client-1',
    tenantId: TENANT_A,
    sessionMfaVerified: false,
    ...overrides,
  };
}

describe('Sprint 4 governance security regression (Task 7)', () => {
  describe('cross-tenant decision boundaries', () => {
    it('Tenant A decision input cannot include Tenant B evidence (approve/execute/verify surface)', () => {
      const snapshot = buildSafeBaselineSnapshot({
        scope: { tenantId: TENANT_A, accountId: ACCOUNT_A },
        observedRecordScopes: [{ tenantId: TENANT_B, accountId: ACCOUNT_B }],
      });
      const contradictions = detectContradictions(snapshot);
      assert.ok(
        contradictions.some(
          (c) => c.code === GOVERNANCE_REGRESSION_REASON.CONTRADICTION_CROSS_TENANT_DECISION_INPUT,
        ),
      );
    });

    it('Tenant A cannot rollback Tenant B execution', () => {
      const decision = evaluateRollbackAuthorization({
        evaluatedAt: FIXED_AT,
        executionId: 'exec-tenant-b',
        executionScope: { tenantId: TENANT_B, accountId: ACCOUNT_B },
        requestScope: { tenantId: TENANT_A, accountId: ACCOUNT_A },
        executionState: 'EXECUTED',
        alreadyRolledBack: false,
        verificationOutcome: 'ROLLBACK_CANDIDATE',
        rollbackEvidenceSufficient: true,
        requestedBy: {
          source: 'HUMAN_ACTOR',
          actorId: 'actor-owner-a',
          authorized: true,
          mfaVerified: true,
        },
      });
      assert.equal(decision.authorized, false);
      assert.ok(decision.reasonCodes.includes(ROLLBACK_AUTHORIZATION_REASON.DENIED_CROSS_TENANT));
    });
  });

  describe('RBAC: unauthorized role cannot approve or rollback', () => {
    it('unauthorized tenant analyst cannot approve', () => {
      const authorized = canPerformExecutionPrivilegedAction(
        TENANT_ROLES.ANALYST,
        ['analyst'],
        false,
      );
      const gate = evaluateActionPolicyActorGate({
        authorized,
        mfaVerified: true,
        privilegedActionRequired: true,
      });
      assert.equal(authorized, false);
      assert.equal(gate.permitted, false);
      assert.ok(gate.reasonCodes.includes(ACTION_POLICY_REASON.AUTHORIZATION_BLOCKED));
    });

    it('unauthorized tenant analyst cannot rollback', () => {
      const decision = evaluateRollbackAuthorization({
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
          actorId: 'actor-analyst',
          authorized: canPerformExecutionPrivilegedAction(TENANT_ROLES.ANALYST, ['analyst'], false),
          mfaVerified: true,
        },
      });
      assert.equal(decision.authorized, false);
      assert.ok(
        decision.reasonCodes.includes(ROLLBACK_AUTHORIZATION_REASON.DENIED_ACTOR_UNAUTHORIZED),
      );
    });
  });

  describe('MFA: missing MFA cannot approve or rollback a privileged production action', () => {
    it('missing MFA claim blocks privileged approval', () => {
      const authorized = canPerformExecutionPrivilegedAction(
        TENANT_ROLES.TENANT_OWNER,
        ['admin'],
        false,
      );
      const mfa = evaluatePrivilegedMfa(
        securityContext(),
        identity({ sessionMfaVerified: false }),
        PRIVILEGED_OPERATIONS.EXECUTION_APPROVE,
        { requesterTenantRole: TENANT_ROLES.TENANT_OWNER },
      );
      const gate = evaluateActionPolicyActorGate({
        authorized,
        mfaVerified: mfa.satisfied,
        privilegedActionRequired: true,
      });
      assert.equal(mfa.required, true);
      assert.equal(gate.permitted, false);
      assert.ok(gate.reasonCodes.includes(ACTION_POLICY_REASON.MFA_REQUIRED_BLOCKED));
    });

    it('missing MFA claim blocks privileged rollback', () => {
      const authorized = canPerformExecutionPrivilegedAction(
        TENANT_ROLES.TENANT_OWNER,
        ['admin'],
        false,
      );
      const mfa = evaluatePrivilegedMfa(
        securityContext(),
        identity({ sessionMfaVerified: false }),
        PRIVILEGED_OPERATIONS.EXECUTION_ROLLBACK,
        { requesterTenantRole: TENANT_ROLES.TENANT_OWNER },
      );

      const decision = evaluateRollbackAuthorization({
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
          actorId: 'actor-owner-a',
          authorized,
          mfaVerified: mfa.satisfied,
        },
      });

      assert.equal(mfa.required, true);
      assert.equal(decision.authorized, false);
      assert.ok(decision.reasonCodes.includes(ROLLBACK_AUTHORIZATION_REASON.DENIED_MFA_REQUIRED));
    });

    it('MFA-verified tenant owner can rollback a same-tenant execution', () => {
      const authorized = canPerformExecutionPrivilegedAction(
        TENANT_ROLES.TENANT_OWNER,
        ['admin'],
        false,
      );
      const mfa = evaluatePrivilegedMfa(
        securityContext(),
        identity({ sessionMfaVerified: true }),
        PRIVILEGED_OPERATIONS.EXECUTION_ROLLBACK,
        { requesterTenantRole: TENANT_ROLES.TENANT_OWNER },
      );

      const decision = evaluateRollbackAuthorization({
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
          actorId: 'owner-1',
          authorized,
          mfaVerified: mfa.satisfied,
        },
      });

      assert.equal(mfa.satisfied, true);
      assert.equal(decision.authorized, true);
      assert.equal(decision.authorizedByActorId, 'owner-1');
    });
  });
});
