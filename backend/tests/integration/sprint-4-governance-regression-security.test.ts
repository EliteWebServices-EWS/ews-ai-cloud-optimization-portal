import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateActionPolicyActorGate,
  ACTION_POLICY_REASON,
} from '../../action-policy';
import { canPerformExecutionPrivilegedAction } from '../../auth/execution-api-authorization';
import {
  evaluatePrivilegedMfa,
  PRIVILEGED_OPERATIONS,
} from '../../auth/privileged-mfa';
import type { RequestSecurityContext } from '../../auth/request-security-context';
import { TENANT_ROLES } from '../../auth/tenant-roles';
import { detectGovernanceContradictions } from '../../governance-regression/contradiction-detector';
import { GOVERNANCE_CONTRADICTION } from '../../governance-regression/reason-codes';
import { qualifyGovernanceSafety } from '../../governance-regression/release-qualification';
import { MockVerificationRepository } from '../../engines/verification/mock-verification.repository';
import { PostActionVerificationScopeError } from '../../post-action-verification/errors';
import { evaluatePostActionVerification } from '../../post-action-verification/evaluate-post-action-verification';
import { ACCOUNT_A, ACCOUNT_B, TENANT_A, TENANT_B } from '../fixtures/evidence/identities';
import {
  buildCrossTenantDecisionDeniedInput,
  buildSafeFullyConsistentInput,
} from '../fixtures/sprint-4-governance/governance-regression-fixtures';
import {
  buildCrossAccountVerificationDeniedInput,
  buildCrossTenantVerificationDeniedInput,
} from '../fixtures/sprint-3-lifecycle/sprint-3-lifecycle-fixtures';

const baseContext: RequestSecurityContext = {
  tenantId: TENANT_A,
  requestId: 'req-s4-gov-regression',
  correlationId: 'corr-s4-gov-regression',
  roles: ['admin'],
  userId: 'owner-a',
  email: 'owner-a@example.com',
  claimPresent: true,
  usedFallback: false,
  invalidClaim: false,
};

describe('Sprint 4 governance regression security', () => {
  it('Tenant A cannot qualify Tenant B decision scope as SAFE', () => {
    const result = qualifyGovernanceSafety(buildCrossTenantDecisionDeniedInput());
    assert.equal(result.result, 'BLOCKED');
  });

  it('cross-tenant verification scope is denied fail-closed', () => {
    assert.throws(
      () =>
        evaluatePostActionVerification({
          ...buildCrossTenantVerificationDeniedInput(),
          comparatorResult: {
            status: 'verified',
            expectedSavings: 1,
            actualSavings: 1,
            verifiedSavings: 1,
            variance: 0,
            variancePercentage: 0,
            stateMatched: true,
          },
        }),
      PostActionVerificationScopeError,
    );
  });

  it('cross-account verification scope is denied fail-closed', () => {
    assert.throws(
      () =>
        evaluatePostActionVerification({
          ...buildCrossAccountVerificationDeniedInput(),
          comparatorResult: {
            status: 'verified',
            expectedSavings: 1,
            actualSavings: 1,
            verifiedSavings: 1,
            variance: 0,
            variancePercentage: 0,
            stateMatched: true,
          },
        }),
      PostActionVerificationScopeError,
    );
  });

  it('Tenant A cannot read Tenant B verification outputs (safe not-found)', async () => {
    const repository = new MockVerificationRepository();
    await repository.save({
      tenantId: TENANT_B,
      accountId: ACCOUNT_B,
      workflowId: 'wf-b',
      executionId: 'exec-b',
      expectation: {
        expectedMonthlySavings: 10,
        expectedInstanceType: 't3.medium',
        previousInstanceType: 't3.large',
        currency: 'USD',
      },
      observation: null,
      result: {
        status: 'verified',
        expectedSavings: 10,
        actualSavings: 10,
        verifiedSavings: 10,
        variance: 0,
        variancePercentage: 0,
        stateMatched: true,
      },
      recordedAt: new Date().toISOString(),
    });

    const lookup = await repository.findByExecutionId(TENANT_A, 'exec-b');
    assert.equal(lookup, undefined);
  });

  it('unauthorized role cannot approve privileged production action', () => {
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

    assert.equal(gate.permitted, false);
    assert.ok(gate.reasonCodes.includes(ACTION_POLICY_REASON.AUTHORIZATION_BLOCKED));
  });

  it('unauthorized role cannot rollback privileged production action', () => {
    const authorized = canPerformExecutionPrivilegedAction(
      TENANT_ROLES.ANALYST,
      ['analyst'],
      false,
    );
    assert.equal(authorized, false);
  });

  it('missing MFA cannot approve privileged production action', () => {
    const authorized = canPerformExecutionPrivilegedAction(
      TENANT_ROLES.TENANT_OWNER,
      ['admin'],
      false,
    );
    const mfa = evaluatePrivilegedMfa(
      baseContext,
      {
        authenticated: true,
        userId: 'owner-a',
        email: 'owner-a@example.com',
        groups: ['admin'],
        rawGroups: ['admin'],
        tokenUse: 'access',
        clientId: 'client-1',
        tenantId: TENANT_A,
        sessionMfaVerified: false,
      },
      PRIVILEGED_OPERATIONS.EXECUTION_APPROVE,
      { requesterTenantRole: TENANT_ROLES.TENANT_OWNER },
    );
    const gate = evaluateActionPolicyActorGate({
      authorized,
      mfaVerified: mfa.satisfied,
      privilegedActionRequired: true,
    });

    assert.equal(gate.permitted, false);
    assert.ok(gate.reasonCodes.includes(ACTION_POLICY_REASON.MFA_REQUIRED_BLOCKED));
  });

  it('missing MFA cannot rollback privileged production action', () => {
    const mfa = evaluatePrivilegedMfa(
      baseContext,
      {
        authenticated: true,
        userId: 'owner-a',
        email: 'owner-a@example.com',
        groups: ['admin'],
        rawGroups: ['admin'],
        tokenUse: 'access',
        clientId: 'client-1',
        tenantId: TENANT_A,
        sessionMfaVerified: false,
      },
      PRIVILEGED_OPERATIONS.EXECUTION_ROLLBACK,
      { requesterTenantRole: TENANT_ROLES.TENANT_OWNER },
    );
    assert.equal(mfa.satisfied, false);
  });

  it('does not leak cross-tenant existence through qualification SAFE result', () => {
    const denied = qualifyGovernanceSafety({
      ...buildSafeFullyConsistentInput(),
      scope: { tenantId: TENANT_A, accountId: ACCOUNT_A, scopeVerified: false },
    });
    assert.notEqual(denied.result, 'SAFE');
  });

  it('detects ML rollback authorization contradiction', () => {
    const contradictions = detectGovernanceContradictions({
      ...buildSafeFullyConsistentInput(),
      rollback: {
        rollbackCandidate: true,
        rollbackAuthorized: true,
        mlAuthorizedRollback: true,
        rollbackActorAuthorized: true,
        rollbackMfaVerified: true,
        rollbackAttributionPresent: true,
      },
    });
    assert.ok(
      contradictions.some(
        (item) =>
          item.code === GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ML_AUTHORIZED_ROLLBACK,
      ),
    );
  });
});
