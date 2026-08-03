import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from '../../index';
import { getAuthenticatedIdentity } from '../../auth/identity';
import {
  evaluatePrivilegedMfa,
  hasTrustedSessionMfaEvidence,
  PRIVILEGED_OPERATIONS,
} from '../../auth/privileged-mfa';
import { buildRequestSecurityContext } from '../../auth/request-security-context';
import { SISUM_ROLES } from '../../auth/roles';
import {
  stripInternalIdentityHeaders,
  stripSessionMfaVerifiedHeaders,
} from '../../auth/internal-identity-headers';
import { createIdentitySourceMiddleware } from '../../auth/identity-source';
import { attachValidatedIdentityHeaders } from '../../lambda';

function createMockRequest(
  headers: Record<string, string | string[] | undefined>,
): import('express').Request {
  return {
    headers,
    header(name: string) {
      const target = name.toLowerCase();

      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === target) {
          return Array.isArray(value) ? value[0] : value;
        }
      }

      return undefined;
    },
    method: 'POST',
    path: '/api/v1/admin/tenants',
  } as import('express').Request;
}

async function requestDirectApp(
  headers: Record<string, string>,
  path = '/api/v1/admin/tenants',
  method = 'POST',
  body?: unknown,
): Promise<{ status: number; body: string }> {
  process.env.NODE_ENV = 'test';
  process.env.PERSISTENCE_ENABLED = 'false';

  const app = createApp({ identitySource: 'direct-http' });
  const server = app.listen(0);
  const address = server.address() as AddressInfo;
  const payload = body === undefined ? undefined : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        method,
        path,
        headers: {
          ...(payload
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode ?? 0, body: raw });
        });
      },
    );

    req.on('error', (error) => {
      server.close();
      reject(error);
    });

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

describe('direct-http identity source (untrusted)', () => {
  it('strips x-sisum-mfa-session-verified before identity extraction', () => {
    const headers: Record<string, string> = {
      'x-sisum-mfa-session-verified': 'true',
    };

    const middleware = createIdentitySourceMiddleware('direct-http');
    const req = createMockRequest(headers);

    middleware(req, {} as import('express').Response, () => {
      assert.equal(getAuthenticatedIdentity(req).sessionMfaVerified, false);
    });
  });

  it('strips mixed-case and duplicate internal identity headers', () => {
    const headers: Record<string, string> = {
      'X-SISUM-MFA-SESSION-VERIFIED': 'true',
      'x-sisum-user-id': 'attacker',
      'X-SISUM-TENANT-ID': 'tenant-evil',
      'x-sisum-user-groups': 'admin',
      'x-sisum-authenticated': 'true',
    };

    stripInternalIdentityHeaders(headers);
    assert.deepEqual(headers, {});
  });

  it('direct HTTP privileged create tenant cannot use spoofed identity', async () => {
    const response = await requestDirectApp(
      {
        'x-sisum-authenticated': 'true',
        'x-sisum-user-id': 'spoof-admin',
        'x-sisum-user-groups': 'admin',
        'x-sisum-tenant-id': 'tenant-a',
        'X-SISUM-MFA-SESSION-VERIFIED': 'true',
      },
      '/api/v1/admin/tenants',
      'POST',
      {
        organizationName: 'Evil',
        displayName: 'Evil',
        slug: 'evil-direct-http',
        ownerUserId: 'owner',
        primaryContact: { name: 'E', email: 'e@example.com' },
        region: 'us-east-1',
        subscriptionPlan: 'standard',
      },
    );

    assert.notEqual(response.status, 201);
    assert.match(response.body, /AUTHENTICATION_REQUIRED|MFA_EVIDENCE_UNAVAILABLE|FORBIDDEN/);
  });

  it('direct HTTP cannot spoof user ID or admin groups', () => {
    const headers: Record<string, string> = {
      'x-sisum-authenticated': 'true',
      'x-sisum-user-id': 'spoof-admin',
      'x-sisum-user-groups': 'admin,tenant-admin',
    };

    const middleware = createIdentitySourceMiddleware('direct-http');
    const req = createMockRequest(headers);

    middleware(req, {} as import('express').Response, () => {
      const identity = getAuthenticatedIdentity(req);
      assert.equal(identity.userId, null);
      assert.equal(identity.groups.length, 0);
      assert.equal(identity.authenticated, false);
    });
  });

  it('spoofed MFA header on direct HTTP yields MFA_EVIDENCE_UNAVAILABLE when identity would otherwise be privileged', () => {
    const headers: Record<string, string> = {
      'x-sisum-authenticated': 'true',
      'x-sisum-user-id': 'admin-user',
      'x-sisum-user-groups': 'admin',
      'x-sisum-mfa-session-verified': 'true',
      'X-SISUM-MFA-SESSION-VERIFIED': 'TRUE',
    };

    const middleware = createIdentitySourceMiddleware('direct-http');
    const req = createMockRequest(headers);

    middleware(req, {} as import('express').Response, () => {
      const identity = getAuthenticatedIdentity(req);
      assert.equal(identity.sessionMfaVerified, false);
      assert.equal(identity.authenticated, false);
      assert.equal(hasTrustedSessionMfaEvidence(identity), false);

      const privilegedIdentity = {
        authenticated: true,
        userId: 'admin-user',
        email: null,
        groups: [SISUM_ROLES.ADMIN],
        rawGroups: ['admin'],
        tokenUse: 'access',
        clientId: null,
        tenantId: 'tenant-a',
        sessionMfaVerified: false,
      };

      const context = buildRequestSecurityContext(req, privilegedIdentity);

      const decision = evaluatePrivilegedMfa(
        context,
        privilegedIdentity,
        PRIVILEGED_OPERATIONS.TENANT_CREATE,
      );

      assert.equal(decision.required, true);
      assert.equal(decision.satisfied, false);
      assert.equal(decision.evidenceUnavailable, true);
    });
  });

  it('direct HTTP cannot spoof tenant via x-sisum-tenant-id', () => {
    const headers: Record<string, string> = {
      'x-sisum-authenticated': 'true',
      'x-sisum-user-id': 'u1',
      'x-sisum-user-groups': 'admin',
      'x-sisum-tenant-id': 'spoof-tenant',
    };

    const middleware = createIdentitySourceMiddleware('direct-http');
    const req = createMockRequest(headers);

    middleware(req, {} as import('express').Response, () => {
      assert.equal(getAuthenticatedIdentity(req).tenantId, null);
      assert.equal(getAuthenticatedIdentity(req).authenticated, false);
    });
  });
});

describe('lambda-adapter mode preserves adapter headers', () => {
  it('does not strip headers set by attachValidatedIdentityHeaders', () => {
    const event = {
      headers: {},
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              sub: 'user-1',
              'cognito:groups': 'admin',
              token_use: 'access',
              tenant_id: 'tenant-trusted',
              mfa_session_verified: true,
            },
          },
        },
      },
    } as unknown as Parameters<typeof attachValidatedIdentityHeaders>[0];

    attachValidatedIdentityHeaders(event);

    const middleware = createIdentitySourceMiddleware('lambda-adapter');
    const req = createMockRequest(event.headers as Record<string, string>);

    middleware(req, {} as import('express').Response, () => {
      const identity = getAuthenticatedIdentity(req);
      assert.equal(identity.authenticated, true);
      assert.equal(identity.userId, 'user-1');
      assert.equal(identity.tenantId, 'tenant-trusted');
      assert.equal(identity.sessionMfaVerified, true);
    });
  });

  it('preserves MFA header when JWT claim is string "true" (API Gateway normalization)', () => {
    const event = {
      headers: {},
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              sub: 'user-1',
              'cognito:groups': 'admin',
              token_use: 'access',
              tenant_id: 'tenant-trusted',
              mfa_session_verified: 'true',
            },
          },
        },
      },
    } as unknown as Parameters<typeof attachValidatedIdentityHeaders>[0];

    attachValidatedIdentityHeaders(event);

    const middleware = createIdentitySourceMiddleware('lambda-adapter');
    const req = createMockRequest(event.headers as Record<string, string>);

    middleware(req, {} as import('express').Response, () => {
      assert.equal(getAuthenticatedIdentity(req).sessionMfaVerified, true);
    });
  });
});

describe('stripSessionMfaVerifiedHeaders helper', () => {
  it('removes all casings of session MFA header', () => {
    const headers: Record<string, string> = {
      'X-SISUM-MFA-SESSION-VERIFIED': 'true',
      'x-sisum-mfa-session-verified': 'true',
    };
    stripSessionMfaVerifiedHeaders(headers);
    assert.deepEqual(headers, {});
  });
});
