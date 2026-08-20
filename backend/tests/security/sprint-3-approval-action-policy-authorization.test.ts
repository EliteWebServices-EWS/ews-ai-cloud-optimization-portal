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

const baseContext: RequestSecurityContext = {
  tenantId: 'tenant-a',
  requestId: 'req-mfa-1',
  correlationId: 'corr-mfa-1',
  roles: ['admin'],
  userId: 'owner-1',
  email: 'owner-1@example.com',
  claimPresent: true,
  usedFallback: false,
  invalidClaim: false,
};

describe('Sprint 3 approval action policy authorization and MFA', () => {
  it('denies unauthorized tenant analyst for privileged approval actions', () => {
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

  it('denies privileged approval when MFA claim is missing', () => {
    const authorized = canPerformExecutionPrivilegedAction(
      TENANT_ROLES.TENANT_OWNER,
      ['admin'],
      false,
    );
    const mfa = evaluatePrivilegedMfa(
      baseContext,
      {
        authenticated: true,
        userId: 'owner-1',
        email: 'owner-1@example.com',
        groups: ['admin'],
        rawGroups: ['admin'],
        tokenUse: 'access',
        clientId: 'client-1',
        tenantId: 'tenant-a',
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

    assert.equal(authorized, true);
    assert.equal(mfa.required, true);
    assert.equal(gate.permitted, false);
    assert.ok(gate.reasonCodes.includes(ACTION_POLICY_REASON.MFA_REQUIRED_BLOCKED));
  });

  it('permits authorized tenant owner with MFA for privileged approval', () => {
    const authorized = canPerformExecutionPrivilegedAction(
      TENANT_ROLES.TENANT_OWNER,
      ['admin'],
      false,
    );
    const mfa = evaluatePrivilegedMfa(
      baseContext,
      {
        authenticated: true,
        userId: 'owner-1',
        email: 'owner-1@example.com',
        groups: ['admin'],
        rawGroups: ['admin'],
        tokenUse: 'access',
        clientId: 'client-1',
        tenantId: 'tenant-a',
        sessionMfaVerified: true,
      },
      PRIVILEGED_OPERATIONS.EXECUTION_APPROVE,
      { requesterTenantRole: TENANT_ROLES.TENANT_OWNER },
    );
    const gate = evaluateActionPolicyActorGate({
      authorized,
      mfaVerified: mfa.satisfied,
      privilegedActionRequired: true,
    });

    assert.equal(gate.permitted, true);
  });
});
