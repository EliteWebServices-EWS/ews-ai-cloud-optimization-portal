import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { Request } from 'express';
import {
  getAuthenticatedIdentity,
  hasRecognizedRole,
  parseGroups,
  parseRawGroups,
} from '../../auth/identity';
import { SISUM_ROLES } from '../../auth/roles';
import { attachValidatedIdentityHeaders } from '../../lambda';
import type {
  APIGatewayProxyEventV2,
  Context,
} from 'aws-lambda';

function createMockRequest(
  headers: Record<string, string>
): Request {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  } as Request;
}

test('parseRawGroups handles comma-separated Cognito groups', () => {
  assert.deepEqual(parseRawGroups('admin,viewer'), [
    'admin',
    'viewer',
  ]);
});

test('parseGroups returns only recognized SISUM roles', () => {
  assert.deepEqual(
    parseGroups('admin,unknown-group,viewer'),
    [SISUM_ROLES.ADMIN, SISUM_ROLES.VIEWER]
  );
});

test('getAuthenticatedIdentity extracts email when claim is present', () => {
  const identity = getAuthenticatedIdentity(
    createMockRequest({
      'x-sisum-authenticated': 'true',
      'x-sisum-user-id': 'user-123',
      'x-sisum-user-email': 'analyst@elitewebservices.org',
      'x-sisum-user-groups': 'analyst',
      'x-sisum-token-use': 'access',
      'x-sisum-client-id': 'client-abc',
    })
  );

  assert.equal(identity.authenticated, true);
  assert.equal(identity.userId, 'user-123');
  assert.equal(
    identity.email,
    'analyst@elitewebservices.org'
  );
  assert.deepEqual(identity.groups, [SISUM_ROLES.ANALYST]);
  assert.equal(identity.tokenUse, 'access');
});

test('getAuthenticatedIdentity normalizes empty email to null', () => {
  const identity = getAuthenticatedIdentity(
    createMockRequest({
      'x-sisum-authenticated': 'true',
      'x-sisum-user-id': 'user-123',
      'x-sisum-user-email': '   ',
      'x-sisum-user-groups': 'viewer',
    })
  );

  assert.equal(identity.email, null);
});

test('hasRecognizedRole rejects unknown Cognito groups', () => {
  const identity = getAuthenticatedIdentity(
    createMockRequest({
      'x-sisum-authenticated': 'true',
      'x-sisum-user-id': 'user-123',
      'x-sisum-user-groups': 'contractor,external',
    })
  );

  assert.equal(hasRecognizedRole(identity.groups), false);
  assert.deepEqual(identity.rawGroups, [
    'contractor',
    'external',
  ]);
});

test('multiple recognized groups preserve precedence filtering', () => {
  const identity = getAuthenticatedIdentity(
    createMockRequest({
      'x-sisum-authenticated': 'true',
      'x-sisum-user-id': 'user-123',
      'x-sisum-user-groups': 'viewer,admin',
    })
  );

  assert.deepEqual(identity.groups, [
    SISUM_ROLES.VIEWER,
    SISUM_ROLES.ADMIN,
  ]);
});

test('lambda attachValidatedIdentityHeaders rejects non-access token_use', async () => {
  const event = {
    headers: {
      'x-sisum-authenticated': 'true',
      'x-sisum-user-id': 'spoofed',
    },
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: 'cognito-user',
            email: 'admin@elitewebservices.org',
            'cognito:groups': 'admin',
            token_use: 'id',
          },
        },
      },
    },
  } as unknown as Parameters<typeof attachValidatedIdentityHeaders>[0];

  attachValidatedIdentityHeaders(event);

  assert.equal(
    event.headers['x-sisum-authenticated'],
    undefined
  );
  assert.equal(event.headers['x-sisum-user-id'], undefined);
});

test('lambda attachValidatedIdentityHeaders copies trusted access-token claims', async () => {
  const event = {
    headers: {},
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: 'cognito-user',
            email: 'viewer@elitewebservices.org',
            'cognito:groups': 'viewer',
            token_use: 'access',
            client_id: 'public-client',
          },
        },
      },
    },
  } as unknown as Parameters<typeof attachValidatedIdentityHeaders>[0];

  attachValidatedIdentityHeaders(event);

  assert.equal(event.headers['x-sisum-authenticated'], 'true');
  assert.equal(event.headers['x-sisum-user-id'], 'cognito-user');
  assert.equal(
    event.headers['x-sisum-user-email'],
    'viewer@elitewebservices.org'
  );
  assert.equal(event.headers['x-sisum-user-groups'], 'viewer');
});

test('lambda attachValidatedIdentityHeaders omits tenant header when claim missing', async () => {
  const event = {
    headers: {},
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: 'cognito-user',
            email: 'viewer@elitewebservices.org',
            'cognito:groups': 'viewer',
            token_use: 'access',
            client_id: 'public-client',
          },
        },
      },
    },
  } as unknown as Parameters<typeof attachValidatedIdentityHeaders>[0];

  attachValidatedIdentityHeaders(event);

  assert.equal(event.headers['x-sisum-tenant-id'], undefined);
});

test('sessionMfaVerified is true only when lambda sets trusted internal header', () => {
  const verified = getAuthenticatedIdentity(
    createMockRequest({
      'x-sisum-authenticated': 'true',
      'x-sisum-user-id': 'admin-1',
      'x-sisum-user-groups': 'admin',
      'x-sisum-mfa-session-verified': 'true',
    })
  );

  assert.equal(verified.sessionMfaVerified, true);
});

test('sessionMfaVerified is false when claim header is missing', () => {
  const identity = getAuthenticatedIdentity(
    createMockRequest({
      'x-sisum-authenticated': 'true',
      'x-sisum-user-id': 'admin-1',
      'x-sisum-user-groups': 'admin',
    })
  );

  assert.notEqual(identity.sessionMfaVerified, true);
});

test('sessionMfaVerified is false when internal header is not exactly true', () => {
  for (const headerValue of ['false', 'null', '1', '']) {
    const identity = getAuthenticatedIdentity(
      createMockRequest({
        'x-sisum-authenticated': 'true',
        'x-sisum-user-id': 'admin-1',
        'x-sisum-user-groups': 'admin',
        'x-sisum-mfa-session-verified': headerValue,
      })
    );

    assert.notEqual(identity.sessionMfaVerified, true);
  }
});

test('admin role alone does not set sessionMfaVerified', () => {
  const identity = getAuthenticatedIdentity(
    createMockRequest({
      'x-sisum-authenticated': 'true',
      'x-sisum-user-id': 'admin-1',
      'x-sisum-user-groups': 'admin',
    })
  );

  assert.deepEqual(identity.groups, [SISUM_ROLES.ADMIN]);
  assert.notEqual(identity.sessionMfaVerified, true);
});

test('auth template defines custom tenantId attribute', () => {
  const templatePath = path.resolve(
    __dirname,
    '../../../infrastructure/auth/template.yaml'
  );
  const template = readFileSync(templatePath, 'utf8');

  assert.match(template, /Name: tenantId/);
  assert.match(template, /MinLength: "1"/);
  assert.match(template, /MaxLength: "64"/);
});

test('auth template requires TOTP MFA at the user pool', () => {
  const templatePath = path.resolve(
    __dirname,
    '../../../infrastructure/auth/template.yaml'
  );
  const template = readFileSync(templatePath, 'utf8');

  assert.match(template, /MfaConfiguration:\s*ON/);
  assert.match(template, /SOFTWARE_TOKEN_MFA/);
  assert.doesNotMatch(template, /SMS_MFA/);
  assert.match(template, /Name:\s*verified_email/);
});

// Ensure exported handler remains callable after identity hardening.
test('lambda handler export remains defined', async () => {
  const module = await import('../../lambda');
  assert.equal(typeof module.handler, 'function');

  void ({} as Context);
  void ({} as APIGatewayProxyEventV2);
});
