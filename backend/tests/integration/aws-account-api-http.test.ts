import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import http from 'node:http';

import { createAwsAccountRoutes } from '../../api/routes/aws-account.routes';
import {
  ALL_AUTHENTICATED_ROLES,
  createIdentitySourceMiddleware,
  requireAnyRole,
  requireTenantContext,
  TENANT_ROLES,
} from '../../auth';
import { InMemoryMembershipRepository } from '../../membership/membership.store';
import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';
import {
  AwsAccountApiService,
  type AwsAccountDiscoveryRunner,
  type AwsAccountPermissionChecker,
} from '../../services/aws-account-api-service';
import { StsCredentialProvider, type StsCredentialProviderDeps } from '../../execution/adapters/sts';

const TENANT_A = 'tenant-aws-http-a';
const TENANT_B = 'tenant-aws-http-b';

interface TestIdentity {
  userId: string;
  tenantId: string;
  groups?: string[];
  sessionMfaVerified?: boolean;
}

function identityHeaders(identity: TestIdentity): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-sisum-authenticated': 'true',
    'x-sisum-token-use': 'access',
    'x-sisum-client-id': 'test-client',
    'x-sisum-user-id': identity.userId,
    'x-sisum-user-email': `${identity.userId}@example.com`,
    'x-sisum-user-groups': (identity.groups ?? ['admin']).join(','),
    'x-sisum-tenant-id': identity.tenantId,
    ...(identity.sessionMfaVerified ? { 'x-sisum-mfa-session-verified': 'true' } : {}),
  };
}

function ownerIdentity(userId: string, tenantId: string, sessionMfaVerified = true): TestIdentity {
  return { userId, tenantId, groups: ['admin'], sessionMfaVerified };
}

function viewerIdentity(userId: string, tenantId: string): TestIdentity {
  return { userId, tenantId, groups: ['viewer'] };
}

/** Fake STS response builder — never hits a real AWS endpoint. */
function fakeStsClient(outcome: 'success' | 'access-denied') {
  return {
    send: async () => {
      if (outcome === 'access-denied') {
        const error = new Error('User is not authorized to perform sts:AssumeRole');
        error.name = 'AccessDenied';
        throw error;
      }
      return {
        Credentials: {
          AccessKeyId: 'ASIAFAKE',
          SecretAccessKey: 'fake-secret',
          SessionToken: 'fake-session-token',
          Expiration: new Date(Date.now() + 3600_000),
        },
        AssumedRoleUser: { AssumedRoleId: 'AROAFAKE:sisum-verify' },
      };
    },
  } as unknown as StsCredentialProviderDeps['stsClient'];
}

function allGrantedPermissionChecker(): AwsAccountPermissionChecker {
  return {
    async check() {
      return { allGranted: true, results: [] };
    },
  };
}

interface TestContext {
  membershipRepository: InMemoryMembershipRepository;
  app: express.Application;
}

function defaultDiscoveryRunner(): AwsAccountDiscoveryRunner {
  return async () => ({
    accountId: '111122223333',
    principalArn: 'arn:aws:sts::111122223333:assumed-role/SisumExecutionRole/session',
    enabledRegions: ['us-east-1'],
    discoveredAt: new Date().toISOString(),
    permissionSummary: {
      requiredReadCapabilities: [],
      optionalDiscoveryCapabilities: [],
      leastPrivilegeAssurance: 'NOT_VERIFIED',
      leastPrivilegeReason: 'read probes only',
      executionReadReport: { allGranted: true, results: [] },
    },
    warnings: [],
  });
}

function buildApp(
  sts: 'success' | 'access-denied' = 'success',
  discoveryRunner: AwsAccountDiscoveryRunner = defaultDiscoveryRunner(),
): TestContext {
  const membershipRepository = new InMemoryMembershipRepository();
  const credentialProvider = new StsCredentialProvider({
    stsClient: fakeStsClient(sts),
    maxAttempts: 1,
  });
  const awsAccountApi = new AwsAccountApiService(
    new MockAwsAccountRepository(),
    credentialProvider,
    allGrantedPermissionChecker(),
    discoveryRunner,
  );

  const app = express();
  app.use(express.json());
  app.use(createIdentitySourceMiddleware('lambda-adapter'));
  app.use(
    '/api/v1',
    requireAnyRole(...ALL_AUTHENTICATED_ROLES),
    requireTenantContext(),
    createAwsAccountRoutes({ awsAccountApi, membershipRepository }),
  );

  return { membershipRepository, app };
}

async function seedOwner(ctx: TestContext, tenantId: string, userId: string) {
  await ctx.membershipRepository.create({
    tenantId,
    userId,
    memberId: `member-${userId}`,
    role: TENANT_ROLES.TENANT_OWNER,
    status: 'ACTIVE',
    joinedAt: new Date().toISOString(),
    statusChangedAt: new Date().toISOString(),
  });
}

async function withHttpServer<T>(
  app: express.Application,
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    return await fn(`http://127.0.0.1:${(address as { port: number }).port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function httpJson(
  baseUrl: string,
  method: string,
  path: string,
  identity: TestIdentity,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: identityHeaders(identity),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

function registerBody(overrides: Record<string, unknown> = {}) {
  return {
    accountId: '111122223333',
    roleArn: 'arn:aws:iam::111122223333:role/SisumExecutionRole',
    region: 'us-east-1',
    ...overrides,
  };
}

describe('AWS Account API HTTP integration', () => {
  before(() => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
  });

  after(() => {
    delete process.env.AUDIT_PERSISTENCE_ENABLED;
  });

  describe('POST /api/v1/aws-accounts (register)', () => {
    it('registers an account for an authorized owner with 201 and an unmasked externalId', async () => {
      const ctx = buildApp();
      await seedOwner(ctx, TENANT_A, 'owner-a');

      await withHttpServer(ctx.app, async (baseUrl) => {
        const response = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-a', TENANT_A),
          registerBody(),
        );

        assert.equal(response.status, 201);
        const data = response.body.data as Record<string, unknown>;
        assert.equal(data.tenantId, TENANT_A);
        assert.equal(data.accountId, '111122223333');
        assert.equal(data.status, 'PENDING');
        assert.ok(typeof data.externalId === 'string' && !(data.externalId as string).includes('•'));
      });
    });

    it('rejects a viewer (RBAC enforced)', async () => {
      const ctx = buildApp();

      await withHttpServer(ctx.app, async (baseUrl) => {
        const response = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          viewerIdentity('viewer-a', TENANT_A),
          registerBody(),
        );

        assert.equal(response.status, 403);
      });
    });

    it('rejects tenantId supplied in the body', async () => {
      const ctx = buildApp();
      await seedOwner(ctx, TENANT_A, 'owner-a');

      await withHttpServer(ctx.app, async (baseUrl) => {
        const response = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-a', TENANT_A),
          registerBody({ tenantId: TENANT_B }),
        );

        assert.equal(response.status, 422);
      });
    });

    it('rejects duplicate registration of the same AWS account (global uniqueness)', async () => {
      const ctx = buildApp();
      await seedOwner(ctx, TENANT_A, 'owner-a');
      await seedOwner(ctx, TENANT_B, 'owner-b');

      await withHttpServer(ctx.app, async (baseUrl) => {
        const first = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-a', TENANT_A),
          registerBody(),
        );
        assert.equal(first.status, 201);

        // Same tenant re-registering the same account.
        const second = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-a', TENANT_A),
          registerBody(),
        );
        assert.equal(second.status, 409);

        // A different tenant cannot claim the same AWS account either.
        const third = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-b', TENANT_B),
          registerBody(),
        );
        assert.equal(third.status, 409);
      });
    });
  });

  describe('tenant isolation', () => {
    it("never returns another tenant's AWS account connection (safe 404)", async () => {
      const ctx = buildApp();
      await seedOwner(ctx, TENANT_A, 'owner-a');
      await seedOwner(ctx, TENANT_B, 'owner-b');

      await withHttpServer(ctx.app, async (baseUrl) => {
        const created = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-a', TENANT_A),
          registerBody(),
        );
        const accountId = (created.body.data as Record<string, unknown>).accountId as string;

        const crossTenantRead = await httpJson(
          baseUrl,
          'GET',
          `/api/v1/aws-accounts/${accountId}`,
          ownerIdentity('owner-b', TENANT_B),
        );
        assert.equal(crossTenantRead.status, 404);

        const ownTenantRead = await httpJson(
          baseUrl,
          'GET',
          `/api/v1/aws-accounts/${accountId}`,
          ownerIdentity('owner-a', TENANT_A),
        );
        assert.equal(ownTenantRead.status, 200);
      });
    });

    it("list only returns the caller's tenant accounts", async () => {
      const ctx = buildApp();
      await seedOwner(ctx, TENANT_A, 'owner-a');
      await seedOwner(ctx, TENANT_B, 'owner-b');

      await withHttpServer(ctx.app, async (baseUrl) => {
        await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-a', TENANT_A),
          registerBody({ accountId: '111100000000', roleArn: 'arn:aws:iam::111100000000:role/R' }),
        );
        await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-b', TENANT_B),
          registerBody({ accountId: '222200000000', roleArn: 'arn:aws:iam::222200000000:role/R' }),
        );

        const listA = await httpJson(
          baseUrl,
          'GET',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-a', TENANT_A),
        );
        const dataA = listA.body.data as Record<string, unknown>;
        const accountsA = dataA.accounts as Array<Record<string, unknown>>;
        assert.equal(accountsA.length, 1);
        assert.equal(accountsA[0].tenantId, TENANT_A);
      });
    });
  });

  describe('lifecycle: verify (real STS seam, faked transport), status, update, remove', () => {
    it('verify moves PENDING -> VERIFIED via a real StsCredentialProvider call and masks externalId thereafter', async () => {
      const ctx = buildApp('success');
      await seedOwner(ctx, TENANT_A, 'owner-a');

      await withHttpServer(ctx.app, async (baseUrl) => {
        const created = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-a', TENANT_A),
          registerBody(),
        );
        const account = created.body.data as Record<string, unknown>;

        const verified = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/aws-accounts/${account.accountId}/verify`,
          ownerIdentity('owner-a', TENANT_A),
          { expectedVersion: account.version },
        );

        assert.equal(verified.status, 200);
        const verifiedData = verified.body.data as Record<string, unknown>;
        assert.equal(verifiedData.succeeded, true);
        const verifiedAccount = verifiedData.account as Record<string, unknown>;
        assert.equal(verifiedAccount.status, 'VERIFIED');
        assert.equal(verifiedAccount.verificationStatus, 'SUCCEEDED');
        assert.ok((verifiedAccount.externalId as string).includes('•'));

        const status = await httpJson(
          baseUrl,
          'GET',
          `/api/v1/aws-accounts/${account.accountId}/status`,
          ownerIdentity('owner-a', TENANT_A),
        );
        assert.equal(status.status, 200);
        assert.equal((status.body.data as Record<string, unknown>).status, 'VERIFIED');
      });
    });

    it('verify moves PENDING -> PENDING (reverted) with succeeded:false when AssumeRole is denied', async () => {
      const ctx = buildApp('access-denied');
      await seedOwner(ctx, TENANT_A, 'owner-a');

      await withHttpServer(ctx.app, async (baseUrl) => {
        const created = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-a', TENANT_A),
          registerBody(),
        );
        const account = created.body.data as Record<string, unknown>;

        const verified = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/aws-accounts/${account.accountId}/verify`,
          ownerIdentity('owner-a', TENANT_A),
          { expectedVersion: account.version },
        );

        assert.equal(verified.status, 200);
        const verifiedData = verified.body.data as Record<string, unknown>;
        assert.equal(verifiedData.succeeded, false);
        assert.ok(typeof verifiedData.failureReason === 'string');
        const revertedAccount = verifiedData.account as Record<string, unknown>;
        assert.equal(revertedAccount.status, 'PENDING');
      });
    });

    it('rejects a stale expectedVersion with 409', async () => {
      const ctx = buildApp();
      await seedOwner(ctx, TENANT_A, 'owner-a');

      await withHttpServer(ctx.app, async (baseUrl) => {
        const created = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-a', TENANT_A),
          registerBody(),
        );
        const account = created.body.data as Record<string, unknown>;

        const stale = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/aws-accounts/${account.accountId}/verify`,
          ownerIdentity('owner-a', TENANT_A),
          { expectedVersion: (account.version as number) + 5 },
        );

        assert.equal(stale.status, 409);
      });
    });

    it('updates region/metadata via PATCH but rejects roleArn changes', async () => {
      const ctx = buildApp();
      await seedOwner(ctx, TENANT_A, 'owner-a');

      await withHttpServer(ctx.app, async (baseUrl) => {
        const created = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-a', TENANT_A),
          registerBody(),
        );
        const account = created.body.data as Record<string, unknown>;

        const updated = await httpJson(
          baseUrl,
          'PATCH',
          `/api/v1/aws-accounts/${account.accountId}`,
          ownerIdentity('owner-a', TENANT_A),
          { region: 'eu-west-1', expectedVersion: account.version },
        );
        assert.equal(updated.status, 200);
        assert.equal((updated.body.data as Record<string, unknown>).region, 'eu-west-1');

        const rejected = await httpJson(
          baseUrl,
          'PATCH',
          `/api/v1/aws-accounts/${account.accountId}`,
          ownerIdentity('owner-a', TENANT_A),
          { roleArn: 'arn:aws:iam::111122223333:role/Other', expectedVersion: 2 },
        );
        assert.equal(rejected.status, 422);
      });
    });

    it('removes (soft-deletes) an account, moving status to DELETED', async () => {
      const ctx = buildApp();
      await seedOwner(ctx, TENANT_A, 'owner-a');

      await withHttpServer(ctx.app, async (baseUrl) => {
        const created = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-a', TENANT_A),
          registerBody(),
        );
        const account = created.body.data as Record<string, unknown>;

        const removed = await httpJson(
          baseUrl,
          'DELETE',
          `/api/v1/aws-accounts/${account.accountId}`,
          ownerIdentity('owner-a', TENANT_A),
          { expectedVersion: account.version },
        );

        assert.equal(removed.status, 200);
        assert.equal((removed.body.data as Record<string, unknown>).status, 'DELETED');
      });
    });
  });

  describe('POST /api/v1/aws-accounts/:accountId/discovery', () => {
    it('returns discovery for authorized same-tenant owner without secrets', async () => {
      const ctx = buildApp('success');
      await seedOwner(ctx, TENANT_A, 'owner-a');

      await withHttpServer(ctx.app, async (baseUrl) => {
        const created = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-a', TENANT_A),
          registerBody(),
        );
        const account = created.body.data as Record<string, unknown>;

        const response = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/aws-accounts/${account.accountId}/discovery`,
          ownerIdentity('owner-a', TENANT_A),
        );

        assert.equal(response.status, 200);
        const data = response.body.data as Record<string, unknown>;
        const discovery = data.discovery as Record<string, unknown>;
        assert.equal(discovery.accountId, '111122223333');
        assert.equal(JSON.stringify(response.body).includes('fake-secret'), false);
      });
    });

    it('returns safe 404 for missing and cross-tenant accounts', async () => {
      const ctx = buildApp('success');
      await seedOwner(ctx, TENANT_A, 'owner-a');
      await seedOwner(ctx, TENANT_B, 'owner-b');

      await withHttpServer(ctx.app, async (baseUrl) => {
        const created = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-a', TENANT_A),
          registerBody(),
        );
        const accountId = (created.body.data as Record<string, unknown>).accountId as string;

        const missing = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts/999999999999/discovery',
          ownerIdentity('owner-a', TENANT_A),
        );
        assert.equal(missing.status, 404);

        const crossTenant = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/aws-accounts/${accountId}/discovery`,
          ownerIdentity('owner-b', TENANT_B),
        );
        assert.equal(crossTenant.status, 404);
      });
    });

    it('denies viewers and returns 409 on identity mismatch', async () => {
      const mismatchRunner: AwsAccountDiscoveryRunner = async () => ({
        accountId: '999999999999',
        principalArn: 'arn:aws:sts::999999999999:assumed-role/R/session',
        enabledRegions: ['us-east-1'],
        discoveredAt: new Date().toISOString(),
        permissionSummary: {
          requiredReadCapabilities: [],
          optionalDiscoveryCapabilities: [],
          leastPrivilegeAssurance: 'NOT_VERIFIED',
          leastPrivilegeReason: 'read probes only',
          executionReadReport: { allGranted: true, results: [] },
        },
        warnings: [],
      });

      const ctx = buildApp('success', mismatchRunner);
      await seedOwner(ctx, TENANT_A, 'owner-a');

      await withHttpServer(ctx.app, async (baseUrl) => {
        const created = await httpJson(
          baseUrl,
          'POST',
          '/api/v1/aws-accounts',
          ownerIdentity('owner-a', TENANT_A),
          registerBody(),
        );
        const accountId = (created.body.data as Record<string, unknown>).accountId as string;

        const viewer = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/aws-accounts/${accountId}/discovery`,
          viewerIdentity('viewer-a', TENANT_A),
        );
        assert.equal(viewer.status, 403);

        const mismatch = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/aws-accounts/${accountId}/discovery`,
          ownerIdentity('owner-a', TENANT_A),
        );
        assert.equal(mismatch.status, 409);
      });
    });
  });

  describe('rate limiting', () => {
    it('rejects register requests once the sensitive-route limit is exceeded', async () => {
      const ctx = buildApp();
      await seedOwner(ctx, TENANT_A, 'owner-a');

      await withHttpServer(ctx.app, async (baseUrl) => {
        const identity = ownerIdentity('owner-a', TENANT_A);
        const responses: number[] = [];

        for (let i = 0; i < 12; i += 1) {
          const suffix = String(i).padStart(2, '0');
          const response = await httpJson(
            baseUrl,
            'POST',
            '/api/v1/aws-accounts',
            identity,
            registerBody({
              accountId: `1111000000${suffix}`,
              roleArn: `arn:aws:iam::1111000000${suffix}:role/R`,
            }),
          );
          responses.push(response.status);
        }

        assert.ok(
          responses.includes(429),
          `expected at least one 429 among responses: ${responses.join(',')}`,
        );
      });
    });
  });
});
