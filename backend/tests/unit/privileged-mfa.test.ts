import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request } from 'express';

import {
  evaluatePrivilegedMfa,
  hasTrustedSessionMfaEvidence,
  isAcceptedSessionMfaVerifiedClaim,
  normalizeTrustedBooleanClaim,
  PRIVILEGED_OPERATIONS,
} from '../../auth/privileged-mfa';
import { getAuthenticatedIdentity } from '../../auth/identity';
import { buildRequestSecurityContext } from '../../auth/request-security-context';
import {
  attachValidatedIdentityHeaders,
} from '../../lambda';
import {
  stripSessionMfaVerifiedHeaders,
} from '../../auth/internal-identity-headers';

function mockRequest(headers: Record<string, string>): Request {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    },
    method: 'POST',
    path: '/api/v1/admin/tenants',
  } as Request;
}

function jwtEvent(
  claims: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return {
    headers: { ...headers },
    requestContext: {
      authorizer: {
        jwt: { claims },
      },
    },
  } as unknown as Parameters<typeof attachValidatedIdentityHeaders>[0];
}

describe('mfa_session_verified JWT claim contract', () => {
  it('accepts boolean true', () => {
    assert.equal(isAcceptedSessionMfaVerifiedClaim(true), true);
    assert.equal(normalizeTrustedBooleanClaim(true), true);
  });

  it('accepts exact lowercase string "true"', () => {
    assert.equal(isAcceptedSessionMfaVerifiedClaim('true'), true);
    assert.equal(normalizeTrustedBooleanClaim('true'), true);
  });

  it('rejects string "TRUE"', () => {
    assert.equal(isAcceptedSessionMfaVerifiedClaim('TRUE'), false);
  });

  it('rejects string "True"', () => {
    assert.equal(isAcceptedSessionMfaVerifiedClaim('True'), false);
  });

  it('rejects string "false"', () => {
    assert.equal(isAcceptedSessionMfaVerifiedClaim('false'), false);
  });

  it('rejects number 1', () => {
    assert.equal(isAcceptedSessionMfaVerifiedClaim(1), false);
  });

  it('rejects boolean false', () => {
    assert.equal(isAcceptedSessionMfaVerifiedClaim(false), false);
  });

  it('rejects missing claim (undefined)', () => {
    assert.equal(isAcceptedSessionMfaVerifiedClaim(undefined), false);
  });

  it('rejects malformed object claim', () => {
    assert.equal(isAcceptedSessionMfaVerifiedClaim({ verified: true }), false);
  });

  it('rejects malformed array claim', () => {
    assert.equal(isAcceptedSessionMfaVerifiedClaim([true]), false);
  });

  it('rejects yes, enabled, and SOFTWARE_TOKEN_MFA strings', () => {
    assert.equal(isAcceptedSessionMfaVerifiedClaim('yes'), false);
    assert.equal(isAcceptedSessionMfaVerifiedClaim('enabled'), false);
    assert.equal(isAcceptedSessionMfaVerifiedClaim('SOFTWARE_TOKEN_MFA'), false);
  });
});

describe('Lambda adapter — mfa_session_verified producer', () => {
  const baseClaims = {
    sub: 'user-1',
    'cognito:groups': 'admin',
    token_use: 'access',
  };

  it('sets internal header when JWT claim is boolean true', () => {
    const event = jwtEvent({
      ...baseClaims,
      mfa_session_verified: true,
    });

    attachValidatedIdentityHeaders(event);
    assert.equal(event.headers['x-sisum-mfa-session-verified'], 'true');
  });

  it('sets internal header when API Gateway JWT claim is string "true"', () => {
    const event = jwtEvent({
      ...baseClaims,
      mfa_session_verified: 'true',
    });

    attachValidatedIdentityHeaders(event);
    assert.equal(event.headers['x-sisum-mfa-session-verified'], 'true');
  });

  it('HTTP API v2 authorizer path: requestContext.authorizer.jwt.claims string "true"', () => {
    const event = {
      headers: {},
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              sub: 'prod-user-sub',
              'cognito:groups': '["admin"]',
              token_use: 'access',
              tenant_id: 'sisum-default',
              mfa_session_verified: 'true',
            },
          },
        },
      },
    } as unknown as Parameters<typeof attachValidatedIdentityHeaders>[0];

    attachValidatedIdentityHeaders(event);

    const req = mockRequest(event.headers as Record<string, string>);
    const identity = getAuthenticatedIdentity(req);
    assert.equal(identity.sessionMfaVerified, true);
    assert.equal(hasTrustedSessionMfaEvidence(identity), true);
  });

  it('rejects boolean false JWT claim even with spoofed header', () => {
    const event = jwtEvent(
      { ...baseClaims, mfa_session_verified: false },
      { 'x-sisum-mfa-session-verified': 'true' },
    );

    attachValidatedIdentityHeaders(event);
    assert.equal(event.headers['x-sisum-mfa-session-verified'], undefined);
  });

  it('rejects spoofed header when JWT has no claim', () => {
    const event = jwtEvent(baseClaims, {
      'x-sisum-mfa-session-verified': 'true',
    });

    attachValidatedIdentityHeaders(event);
    assert.equal(event.headers['x-sisum-mfa-session-verified'], undefined);
  });

  it('rejects mixed-case spoofed header without boolean JWT claim', () => {
    const event = jwtEvent(baseClaims, {
      'X-SISUM-MFA-SESSION-VERIFIED': 'true',
    });

    attachValidatedIdentityHeaders(event);
    assert.equal(event.headers['x-sisum-mfa-session-verified'], undefined);
    assert.equal(event.headers['X-SISUM-MFA-SESSION-VERIFIED'], undefined);
  });

  it('stripSessionMfaVerifiedHeaders removes all casings', () => {
    const headers: Record<string, string> = {
      'X-SISUM-MFA-SESSION-VERIFIED': 'true',
      'x-sisum-mfa-session-verified': 'true',
    };
    stripSessionMfaVerifiedHeaders(headers);
    assert.deepEqual(headers, {});
  });
});

describe('Privileged MFA policy (synthetic internal header — not Cognito proof)', () => {
  it('simulates post-lambda context when boolean claim was accepted', () => {
    const req = mockRequest({
      'x-sisum-authenticated': 'true',
      'x-sisum-user-id': 'admin-user',
      'x-sisum-user-groups': 'admin',
      'x-sisum-mfa-session-verified': 'true',
      'x-sisum-tenant-id': 'tenant-a',
    });

    const identity = getAuthenticatedIdentity(req);
    const context = buildRequestSecurityContext(req, identity);

    assert.equal(hasTrustedSessionMfaEvidence(identity), true);

    const result = evaluatePrivilegedMfa(
      context,
      identity,
      PRIVILEGED_OPERATIONS.TENANT_CREATE,
    );

    assert.equal(result.required, true);
    assert.equal(result.satisfied, true);
  });

  it('platform admin without session MFA evidence is not satisfied', () => {
    const req = mockRequest({
      'x-sisum-authenticated': 'true',
      'x-sisum-user-id': 'admin-user',
      'x-sisum-user-groups': 'admin',
      'x-sisum-tenant-id': 'tenant-a',
    });

    const identity = getAuthenticatedIdentity(req);
    const context = buildRequestSecurityContext(req, identity);
    const result = evaluatePrivilegedMfa(
      context,
      identity,
      PRIVILEGED_OPERATIONS.TENANT_CREATE,
    );

    assert.equal(result.required, true);
    assert.equal(result.satisfied, false);
  });
});

describe('Cognito access-token regression (observed non-production sign-in)', () => {
  const realWorldClaims = {
    sub: 'cognito-user-id',
    token_use: 'access',
    scope: 'aws.cognito.signin.user.admin openid profile email',
    tenant_id: 'sisum-default',
    'cognito:groups': '["admin"]',
    amr: null,
    'cognito:amr': null,
  };

  it('real-world token does not produce session MFA header', () => {
    const event = jwtEvent(realWorldClaims, {
      'x-sisum-mfa-session-verified': 'true',
      'X-SISUM-MFA-SESSION-VERIFIED': 'true',
    });

    attachValidatedIdentityHeaders(event);

    assert.equal(event.headers['x-sisum-mfa-session-verified'], undefined);
  });

  it('privileged tenant create remains unsatisfied after real-world claim set', () => {
    const event = jwtEvent(realWorldClaims);

    attachValidatedIdentityHeaders(event);

    const req = mockRequest({
      'x-sisum-authenticated': event.headers['x-sisum-authenticated'] ?? '',
      'x-sisum-user-id': event.headers['x-sisum-user-id'] ?? '',
      'x-sisum-user-groups': event.headers['x-sisum-user-groups'] ?? '',
      'x-sisum-tenant-id': event.headers['x-sisum-tenant-id'] ?? '',
      'x-sisum-token-use': event.headers['x-sisum-token-use'] ?? '',
    });

    const identity = getAuthenticatedIdentity(req);
    const context = buildRequestSecurityContext(req, identity);
    const result = evaluatePrivilegedMfa(
      context,
      identity,
      PRIVILEGED_OPERATIONS.TENANT_CREATE,
    );

    assert.equal(result.required, true);
    assert.equal(result.satisfied, false);
  });

  it('privileged tenant create satisfied when fresh assurance claim is boolean true', () => {
    const event = jwtEvent({
      ...realWorldClaims,
      mfa_session_verified: true,
    });

    attachValidatedIdentityHeaders(event);

    const req = mockRequest({
      'x-sisum-authenticated': event.headers['x-sisum-authenticated'] ?? '',
      'x-sisum-user-id': event.headers['x-sisum-user-id'] ?? '',
      'x-sisum-user-groups': event.headers['x-sisum-user-groups'] ?? '',
      'x-sisum-tenant-id': event.headers['x-sisum-tenant-id'] ?? '',
      'x-sisum-mfa-session-verified':
        event.headers['x-sisum-mfa-session-verified'] ?? '',
    });

    const identity = getAuthenticatedIdentity(req);
    const context = buildRequestSecurityContext(req, identity);
    const result = evaluatePrivilegedMfa(
      context,
      identity,
      PRIVILEGED_OPERATIONS.TENANT_CREATE,
    );

    assert.equal(result.required, true);
    assert.equal(result.satisfied, true);
  });
});
