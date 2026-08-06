import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

import { createEc2SecurityRoutes } from '../../api/routes/ec2-security.routes';
import {
  ALL_AUTHENTICATED_ROLES,
  createIdentitySourceMiddleware,
  requireAnyRole,
  requireTenantContext,
  TENANT_ROLES,
  type TenantRole,
} from '../../auth';
import { InMemoryMembershipRepository } from '../../membership/membership.store';
import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2SecurityRepository } from '../../repositories/mock/mock-ec2-security-repository';
import { Ec2SecurityAnalysisApiService } from '../../services/ec2-security-analysis-api-service';
import { EC2_SECURITY_FINDING_TOKEN_MAX_LENGTH } from '../../repositories/ec2-security-finding-pagination';
import { encodeEc2SecurityFindingNextToken } from '../../repositories/ec2-security-finding-pagination';
import { cloudResourceAccountPartitionKey } from '../../database';
import {
  httpJson,
  seedMembership,
  seedVerifiedAccount,
  type TestIdentity,
} from './ec2-discovery-http.helpers';
import { assertNoSensitiveFields } from './ec2-cost-api-http.helpers';

const TENANT_A = 'tenant-sec-a';
const TENANT_B = 'tenant-sec-b';
const ACCOUNT_A = '111122223333';
const ACCOUNT_B = '222233334444';

function groupsForRole(role: TenantRole): string {
  if (role === TENANT_ROLES.ANALYST) {
    return 'analyst';
  }
  if (role === TENANT_ROLES.VIEWER || role === TENANT_ROLES.AUDITOR) {
    return 'viewer';
  }
  return 'admin';
}

function identity(tenantId: string, role: TenantRole, userId = 'user-1'): TestIdentity {
  return {
    tenantId,
    userId,
    authenticated: true,
    groups: [groupsForRole(role)],
  };
}

describe('EC2 security API matrix', () => {
  let server: http.Server;
  let baseUrl: string;
  let awsAccounts: MockAwsAccountRepository;
  let resources: MockEc2CloudResourceRepository;
  let securityRepo: MockEc2SecurityRepository;
  let membershipRepository: InMemoryMembershipRepository;

  before(async () => {
    awsAccounts = new MockAwsAccountRepository();
    resources = new MockEc2CloudResourceRepository();
    securityRepo = new MockEc2SecurityRepository();
    membershipRepository = new InMemoryMembershipRepository();
    await seedVerifiedAccount(awsAccounts, TENANT_A, ACCOUNT_A, 'us-east-1');
    await seedVerifiedAccount(awsAccounts, TENANT_B, ACCOUNT_B, 'us-east-1');

    const service = new Ec2SecurityAnalysisApiService(
      awsAccounts,
      resources,
      securityRepo,
      securityRepo,
      securityRepo,
    );
    const app = express();
    app.use(express.json());
    app.use(createIdentitySourceMiddleware('lambda-adapter'));
    app.use(requireAnyRole(...ALL_AUTHENTICATED_ROLES));
    app.use(requireTenantContext());
    app.use(
      '/api/v1',
      createEc2SecurityRoutes({ ec2SecurityAnalysisApi: service, membershipRepository }),
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  function api(
    method: string,
    path: string,
    id: TestIdentity,
    body?: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    return httpJson(baseUrl, method, path.startsWith('/api/v1') ? path : `/api/v1${path}`, id, body);
  }

  function data(body: Record<string, unknown>): Record<string, unknown> {
    return (body.data as Record<string, unknown>) ?? {};
  }

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function seedMembershipRole(role: TenantRole, tenantId = TENANT_A, userId = 'matrix-user') {
    await seedMembership(membershipRepository, tenantId, userId, role);
    return identity(tenantId, role, userId);
  }

  it('RBAC: tenant roles for start analysis', async () => {
    for (const role of [
      TENANT_ROLES.TENANT_OWNER,
      TENANT_ROLES.TENANT_ADMIN,
      TENANT_ROLES.SECURITY_ADMIN,
      TENANT_ROLES.ANALYST,
    ] as const) {
      const id = await seedMembershipRole(role, TENANT_A, `start-${role}`);
      const { status } = await api('POST', '/analysis/ec2/security', id, {
        accountId: ACCOUNT_A,
        regions: ['us-east-1'],
      });
      assert.equal(status, 200, role);
    }
    for (const role of [TENANT_ROLES.VIEWER, TENANT_ROLES.AUDITOR] as const) {
      const id = await seedMembershipRole(role, TENANT_A, `deny-${role}`);
      const { status } = await api('POST', '/analysis/ec2/security', id, {
        accountId: ACCOUNT_A,
        regions: ['us-east-1'],
      });
      assert.equal(status, 403, role);
    }
  });

  it('denies unauthenticated and missing membership', async () => {
    const unauth = await api('POST', '/analysis/ec2/security', {
      tenantId: TENANT_A,
      userId: 'x',
      authenticated: false,
      groups: ['admin'],
    }, { accountId: ACCOUNT_A });
    assert.equal(unauth.status, 401);
    const noMember = await api('POST', '/analysis/ec2/security', identity(TENANT_A, TENANT_ROLES.SECURITY_ADMIN, 'no-member'), {
      accountId: ACCOUNT_A,
    });
    assert.equal(noMember.status, 403);
  });

  it('account and tenant validation for analysis', async () => {
    const id = await seedMembershipRole(TENANT_ROLES.SECURITY_ADMIN, TENANT_A, 'acct-val');
    assert.equal((await api('POST', '/analysis/ec2/security', id, { accountId: '999988887777' })).status, 404);
    assert.equal((await api('POST', '/analysis/ec2/security', id, { accountId: ACCOUNT_B })).status, 404);
    await awsAccounts.create({
      tenantId: TENANT_A,
      accountId: '333344445555',
      roleArn: 'arn:aws:iam::333344445555:role/SisumReadOnlyIntegrationRole',
      externalId: 'ext-test-value-never-logged',
      region: 'us-east-1',
      status: 'PENDING',
      verificationStatus: 'NOT_STARTED',
      metadata: {},
    });
    assert.equal(
      (await api('POST', '/analysis/ec2/security', id, { accountId: '333344445555' })).status,
      409,
    );
  });

  it('rejects unsafe body fields and malformed inputs', async () => {
    const id = await seedMembershipRole(TENANT_ROLES.SECURITY_ADMIN, TENANT_A, 'body-val');
    for (const body of [
      { accountId: ACCOUNT_A, tenantId: TENANT_A },
      { accountId: ACCOUNT_A, inventory: [] },
      { accountId: ACCOUNT_A, findings: [] },
      { accountId: ACCOUNT_A, securityScore: 100 },
    ]) {
      assert.equal((await api('POST', '/analysis/ec2/security', id, body)).status, 422);
    }
    assert.equal((await api('POST', '/analysis/ec2/security', id, { accountId: 'not-an-account' })).status, 422);
    assert.equal(
      (await api('POST', '/analysis/ec2/security', id, {
        accountId: ACCOUNT_A,
        regions: ['not-a-region'],
      })).status,
      422,
    );
    assert.equal(
      (await api('POST', '/analysis/ec2/security', id, {
        accountId: ACCOUNT_A,
        regions: ['us-east-1', 'us-east-2', 'us-west-1', 'eu-west-1'],
      })).status,
      422,
    );
  });

  it('validates findings pagination tokens', async () => {
    await seedMembershipRole(TENANT_ROLES.VIEWER, TENANT_A, 'page-val');
    const id = identity(TENANT_A, TENANT_ROLES.VIEWER, 'page-val');
    assert.equal(
      (await api('GET', `/recommendations/ec2/security?accountId=${ACCOUNT_A}&nextToken=not-valid`, id))
        .status,
      422,
    );
    assert.equal(
      (
        await api(
          'GET',
          `/recommendations/ec2/security?accountId=${ACCOUNT_A}&nextToken=${'a'.repeat(
            EC2_SECURITY_FINDING_TOKEN_MAX_LENGTH + 1,
          )}`,
          id,
        )
      ).status,
      422,
    );
    const query = {
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'us-east-1',
      status: 'OPEN',
    };
    const token = encodeEc2SecurityFindingNextToken(query, {
      pk: cloudResourceAccountPartitionKey(TENANT_A, ACCOUNT_A),
      sk: 'EC2_SECURITY_FINDING#us-east-1#RES#i-1#CHK#x#RV#1',
    });
    assert.ok(token);
    const scopeId = await seedMembershipRole(TENANT_ROLES.VIEWER, TENANT_A, 'token-scope');
    assert.equal(
      (
        await api(
          'GET',
          `/recommendations/ec2/security?accountId=${ACCOUNT_A}&region=eu-west-1&nextToken=${encodeURIComponent(token!)}`,
          scopeId,
        )
      ).status,
      422,
    );
    const crossAccount = encodeEc2SecurityFindingNextToken(
      { tenantId: TENANT_A, accountId: ACCOUNT_B, status: 'OPEN' },
      {
        pk: cloudResourceAccountPartitionKey(TENANT_A, ACCOUNT_B),
        sk: 'EC2_SECURITY_FINDING#us-east-1#RES#i-1#CHK#x#RV#1',
      },
    );
    const acctId = await seedMembershipRole(TENANT_ROLES.VIEWER, TENANT_A, 'token-acct');
    assert.equal(
      (
        await api(
          'GET',
          `/recommendations/ec2/security?accountId=${ACCOUNT_A}&nextToken=${encodeURIComponent(crossAccount!)}`,
          acctId,
        )
      ).status,
      422,
    );
  });

  it('zero-instance analysis succeeds without fabricated findings', async () => {
    const id = await seedMembershipRole(TENANT_ROLES.SECURITY_ADMIN, TENANT_A, 'zero-run');
    const run = await api('POST', '/analysis/ec2/security', id, {
      accountId: ACCOUNT_A,
      regions: ['us-east-1'],
    });
    assert.equal(run.status, 200);
    assert.equal(data(run.body).instancesAnalyzed, 0);
    assert.equal(data(run.body).findingsCreated, 0);
    const list = await api('GET', `/recommendations/ec2/security?accountId=${ACCOUNT_A}&status=OPEN`, id);
    assert.equal(list.status, 200);
    assert.equal((data(list.body).items as unknown[]).length, 0);
  });

  it('account-wide and region-specific summary scopes', async () => {
    const id = await seedMembershipRole(TENANT_ROLES.VIEWER, TENANT_A, 'summary-scope');
    await securityRepo.upsertSummary({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'us-east-1',
      securityScore: 70,
      governanceScore: 80,
      complianceScore: 75,
      riskLevel: 'medium',
      instancesAnalyzed: 1,
      openFindingCount: 2,
      analyzedAt: '2026-02-01T00:00:00.000Z',
      analysisRunId: 'run-a',
      version: 1,
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
    await securityRepo.upsertSummary({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'eu-west-1',
      securityScore: 90,
      governanceScore: 90,
      complianceScore: 90,
      riskLevel: 'low',
      instancesAnalyzed: 1,
      openFindingCount: 1,
      analyzedAt: '2026-02-02T00:00:00.000Z',
      analysisRunId: 'run-b',
      version: 1,
      createdAt: '2026-02-02T00:00:00.000Z',
      updatedAt: '2026-02-02T00:00:00.000Z',
    });
    const accountWide = await api('GET', `/security/ec2/summary?accountId=${ACCOUNT_A}`, id);
    assert.equal(accountWide.status, 200);
    assert.equal(data(accountWide.body).scope, 'account');
    assert.equal(data(accountWide.body).instancesAnalyzed, 2);
    const regional = await api('GET', `/security/ec2/summary?accountId=${ACCOUNT_A}&region=us-east-1`, id);
    assert.equal(regional.status, 200);
    assert.equal(data(regional.body).scope, 'region');
    assert.equal(data(regional.body).region, 'us-east-1');
    assertNoSensitiveFields(regional.body);
  });

  it('summary 404 when no data', async () => {
    const id = await seedMembershipRole(TENANT_ROLES.VIEWER, TENANT_B, 'summary-404');
    assert.equal((await api('GET', `/security/ec2/summary?accountId=${ACCOUNT_B}`, id)).status, 404);
  });
});
