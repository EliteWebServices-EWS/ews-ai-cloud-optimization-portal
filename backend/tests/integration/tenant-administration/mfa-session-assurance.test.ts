import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attachValidatedIdentityHeaders,
} from '../../../lambda';
import {
  buildTestApp,
  httpRequest,
  identityHeaders,
  seedActiveTenant,
  seedTenantMembership,
  TENANT_A,
  USER_PLATFORM_ADMIN,
  USER_TENANT_A_OWNER,
  assertNoSecretsInPayload,
} from './fixtures';

describe('MFA session assurance HTTP integration', () => {
  it('privileged route succeeds with fresh-session MFA header simulation', async () => {
    const { app } = buildTestApp();

    const response = await httpRequest(app, 'POST', '/api/v1/admin/tenants', {
      headers: identityHeaders({
        userId: USER_PLATFORM_ADMIN,
        groups: ['admin'],
        tenantId: TENANT_A,
        sessionMfaVerified: true,
      }),
      body: {
        organizationName: 'MFA Org',
        displayName: 'MFA',
        slug: 'mfa-fresh-session',
        ownerUserId: USER_TENANT_A_OWNER,
        primaryContact: { name: 'Owner', email: 'owner@example.com' },
        region: 'us-east-1',
        subscriptionPlan: 'standard',
      },
    });

    assert.equal(response.status, 201);
    assertNoSecretsInPayload(response.rawBody);
    assert.doesNotMatch(response.rawBody, /eyJ/);
  });

  it('privileged route fails with refresh-style claims (no MFA assurance)', async () => {
    const { app } = buildTestApp();

    const response = await httpRequest(app, 'POST', '/api/v1/admin/tenants', {
      headers: identityHeaders({
        userId: USER_PLATFORM_ADMIN,
        groups: ['admin'],
        tenantId: TENANT_A,
      }),
      body: {
        organizationName: 'No MFA Org',
        displayName: 'No MFA',
        slug: 'mfa-refresh-style',
        ownerUserId: USER_TENANT_A_OWNER,
        primaryContact: { name: 'Owner', email: 'owner@example.com' },
        region: 'us-east-1',
        subscriptionPlan: 'standard',
      },
    });

    assert.equal(response.status, 403);
    assert.match(response.rawBody, /MFA_EVIDENCE_UNAVAILABLE/);
    assertNoSecretsInPayload(response.rawBody);
  });

  it('ordinary authenticated GET remains available without MFA assurance', async () => {
    const ctx = buildTestApp();
    await seedActiveTenant(ctx.tenantRepository, {
      tenantId: TENANT_A,
      slug: 'tenant-a',
      ownerUserId: USER_TENANT_A_OWNER,
    });
    await seedTenantMembership(ctx.membershipRepository, {
      tenantId: TENANT_A,
      userId: USER_TENANT_A_OWNER,
      role: 'tenant_owner',
    });

    const response = await httpRequest(ctx.app, 'GET', `/api/v1/admin/tenants/${TENANT_A}`, {
      headers: identityHeaders({
        userId: USER_TENANT_A_OWNER,
        groups: ['admin'],
        tenantId: TENANT_A,
      }),
    });

    assert.equal(response.status, 200);
  });

  it('lambda adapter maps boolean JWT claim to trusted internal header', () => {
    const event = {
      headers: {},
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              sub: USER_PLATFORM_ADMIN,
              token_use: 'access',
              'cognito:groups': 'admin',
              tenant_id: TENANT_A,
              mfa_session_verified: true,
            },
          },
        },
      },
    } as unknown as Parameters<typeof attachValidatedIdentityHeaders>[0];

    attachValidatedIdentityHeaders(event);
    assert.equal(event.headers['x-sisum-mfa-session-verified'], 'true');
  });
});
