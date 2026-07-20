/**
 * Tenant identity security tests — spoofing resistance and enforcement modes.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { Request } from 'express';
import {
  getAuthenticatedIdentity,
  resolveTrustedTenantId,
  TENANT_ACCESS_TOKEN_CLAIM,
} from '../../auth';
import { attachValidatedIdentityHeaders } from '../../lambda';
import { extractTrustedTenantClaim } from '../../auth/tenant-claims';
import { validateWorkflowRunBody } from '../../security';
import { DEFAULT_REGION } from '../../shared/constants';
import { parseAuditQueryFilters } from '../../audit/audit-query';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function createMockRequest(
  headers: Record<string, string>,
  body: unknown = {}
): Request {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    },
    method: 'GET',
    path: '/api/v1/workflows/run',
    body,
  } as Request;
}

test('extractTrustedTenantClaim reads tenant_id from access token claims', () => {
  assert.equal(
    extractTrustedTenantClaim({ tenant_id: 'tenant-acme' }),
    'tenant-acme'
  );
});

test('extractTrustedTenantClaim ignores custom:tenantId on access token path', () => {
  assert.equal(
    extractTrustedTenantClaim({ 'custom:tenantId': 'tenant-spoof' }),
    null
  );
});

test('lambda strips spoofed tenant headers and uses tenant_id claim only', () => {
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
            'cognito:groups': 'viewer',
            token_use: 'access',
            tenant_id: 'tenant-trusted',
            'custom:tenantId': 'must-not-be-used',
          },
        },
      },
    },
  } as unknown as Parameters<typeof attachValidatedIdentityHeaders>[0];

  attachValidatedIdentityHeaders(event);

  assert.equal(event.headers['x-tenant-id'], undefined);
  assert.equal(event.headers['x-sisum-tenant-id'], 'tenant-trusted');
});

test('identity reads internal tenant header set only after Lambda adapter', () => {
  const identity = getAuthenticatedIdentity(
    createMockRequest({
      'x-sisum-authenticated': 'true',
      'x-sisum-user-id': 'user-123',
      'x-sisum-user-groups': 'viewer',
      'x-sisum-tenant-id': 'trusted-after-lambda',
    })
  );

  assert.equal(identity.tenantId, 'trusted-after-lambda');
});

test('workflow body tenantId is ignored by request validator', () => {
  const validated = validateWorkflowRunBody(
    {
      plugin: 'ec2',
      tenantId: 'body-spoofed-tenant',
    },
    DEFAULT_REGION
  );

  assert.equal(validated.plugin, 'ec2');
  assert.equal(
    (validated as { tenantId?: string }).tenantId,
    undefined
  );
});

test('audit query tenantId parameter is rejected', () => {
  assert.throws(
    () =>
      parseAuditQueryFilters(
        { tenantId: 'query-spoofed-tenant' },
        'sisum-default'
      )
  );
});

test('strict mode rejects missing tenant claim with TENANT_REQUIRED', () => {
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
    (error: unknown) =>
      error instanceof Error && error.message.includes('tenant claim')
  );
});

test('compatibility mode falls back when tenant_id claim is missing', () => {
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

test('compatibility resolution flags indicate dual audit events', () => {
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

  assert.equal(resolution.claimPresent, false);
  assert.equal(resolution.usedFallback, true);
});

test('TENANT_ACCESS_TOKEN_CLAIM constant matches architecture', () => {
  assert.equal(TENANT_ACCESS_TOKEN_CLAIM, 'tenant_id');
});
