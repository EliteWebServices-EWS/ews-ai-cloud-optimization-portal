/**
 * Tenant identity, validation, and request context tests.
 * Sprint 10.5.16: trusted tenant claim handling and enforcement modes.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { Request } from 'express';
import {
  getAuthenticatedIdentity,
  resolveDefaultTenantId,
  resolveTenantEnforcementMode,
  resolveTrustedTenantId,
  validateTenantId,
} from '../../auth';
import { attachValidatedIdentityHeaders } from '../../lambda';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function createMockRequest(
  headers: Record<string, string>
): Request {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  } as Request;
}

test('validateTenantId accepts valid tenant identifiers', () => {
  assert.equal(validateTenantId('sisum-default').valid, true);
  assert.equal(validateTenantId('tenant-acme').normalized, 'tenant-acme');
  assert.equal(validateTenantId('a').valid, true);
});

test('validateTenantId rejects invalid tenant identifiers', () => {
  assert.equal(validateTenantId('').valid, false);
  assert.equal(validateTenantId('TENANT A').valid, false);
  assert.equal(validateTenantId('../tenant').valid, false);
  assert.equal(validateTenantId('tenant/acme').valid, false);
  assert.equal(
    validateTenantId('a'.repeat(65)).valid,
    false
  );
});

test('getAuthenticatedIdentity extracts trusted tenant claim header', () => {
  const identity = getAuthenticatedIdentity(
    createMockRequest({
      'x-sisum-authenticated': 'true',
      'x-sisum-user-id': 'user-123',
      'x-sisum-user-groups': 'viewer',
      'x-sisum-tenant-id': 'tenant-acme',
    })
  );

  assert.equal(identity.tenantId, 'tenant-acme');
});

test('resolveTrustedTenantId uses valid custom claim', () => {
  const resolution = resolveTrustedTenantId({
    authenticated: true,
    userId: 'user-123',
    email: 'viewer@example.com',
    groups: ['viewer'],
    rawGroups: ['viewer'],
    tokenUse: 'access',
    clientId: 'client',
    tenantId: 'tenant-acme',
  });

  assert.equal(resolution.tenantId, 'tenant-acme');
  assert.equal(resolution.claimPresent, true);
  assert.equal(resolution.usedFallback, false);
});

test('strict mode rejects missing tenant claim', () => {
  process.env.TENANT_ENFORCEMENT_MODE = 'strict';
  process.env.TENANT_FALLBACK_ENABLED = 'false';

  assert.throws(
    () =>
      resolveTrustedTenantId({
        authenticated: true,
        userId: 'user-123',
        email: null,
        groups: ['viewer'],
        rawGroups: ['viewer'],
        tokenUse: 'access',
        clientId: 'client',
        tenantId: null,
      }),
    /trusted tenant claim is required/i
  );
});

test('compatibility mode falls back to default tenant', () => {
  process.env.TENANT_ENFORCEMENT_MODE = 'compatibility';
  process.env.DEFAULT_TENANT_ID = 'sisum-default';

  const resolution = resolveTrustedTenantId({
    authenticated: true,
    userId: 'user-123',
    email: null,
    groups: ['viewer'],
    rawGroups: ['viewer'],
    tokenUse: 'access',
    clientId: 'client',
    tenantId: null,
  });

  assert.equal(resolution.tenantId, 'sisum-default');
  assert.equal(resolution.usedFallback, true);
});

test('lambda strips client-supplied x-tenant-id and copies trusted tenant_id claim', () => {
  const event = {
    headers: {
      'x-tenant-id': 'spoofed-tenant',
      'x-sisum-tenant-id': 'also-spoofed',
    },
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: 'cognito-user',
            email: 'viewer@example.com',
            'cognito:groups': 'viewer',
            token_use: 'access',
            tenant_id: 'sisum-default',
          },
        },
      },
    },
  } as unknown as Parameters<typeof attachValidatedIdentityHeaders>[0];

  attachValidatedIdentityHeaders(event);

  assert.equal(event.headers['x-tenant-id'], undefined);
  assert.equal(event.headers['x-sisum-tenant-id'], 'sisum-default');
});

test('lambda ignores custom:tenantId on access token claims', () => {
  const event = {
    headers: {},
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: 'cognito-user',
            'cognito:groups': 'viewer',
            token_use: 'access',
            'custom:tenantId': 'must-not-be-used',
          },
        },
      },
    },
  } as unknown as Parameters<typeof attachValidatedIdentityHeaders>[0];

  attachValidatedIdentityHeaders(event);

  assert.equal(event.headers['x-sisum-tenant-id'], undefined);
});

test('resolveDefaultTenantId validates configured fallback', () => {
  process.env.DEFAULT_TENANT_ID = 'sisum-default';
  assert.equal(resolveDefaultTenantId(), 'sisum-default');
});

test('resolveTenantEnforcementMode defaults to compatibility', () => {
  delete process.env.TENANT_ENFORCEMENT_MODE;
  assert.equal(resolveTenantEnforcementMode(), 'compatibility');
});
