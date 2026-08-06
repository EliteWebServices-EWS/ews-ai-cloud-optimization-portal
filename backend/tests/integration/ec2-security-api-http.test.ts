import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import http from 'node:http';

import { createEc2SecurityRoutes } from '../../api/routes/ec2-security.routes';
import { Ec2SecurityAnalysisApiService } from '../../services/ec2-security-analysis-api-service';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2SecurityRepository } from '../../repositories/mock/mock-ec2-security-repository';
import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';
import { InMemoryMembershipRepository } from '../../membership/membership.store';
import {
  seedMembership,
  seedVerifiedAccount,
} from './ec2-discovery-http.helpers';
import {
  ALL_AUTHENTICATED_ROLES,
  createIdentitySourceMiddleware,
  requireAnyRole,
  requireTenantContext,
  TENANT_ROLES,
} from '../../auth';

const TENANT = 'tenant-security';
const ACCOUNT = '111122223333';

let server: http.Server;
let baseUrl: string;

const headers = {
  'content-type': 'application/json',
  'x-sisum-authenticated': 'true',
  'x-sisum-token-use': 'access',
  'x-sisum-client-id': 'test-client',
  'x-sisum-user-id': 'security-analyst',
  'x-sisum-user-email': 'security@example.com',
  'x-sisum-user-groups': 'admin',
  'x-sisum-tenant-id': TENANT,
};

before(async () => {
  const awsAccounts = new MockAwsAccountRepository();
  await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');

  const ec2Repo = new MockEc2CloudResourceRepository();
  await ec2Repo.upsertDiscoveredResource({
    tenantId: TENANT,
    accountId: ACCOUNT,
    region: 'us-east-1',
    resourceType: 'INSTANCE',
    resourceId: 'i-api-risk',
    tags: [{ key: 'Name', value: 'bad' }],
    status: 'ACTIVE',
    metadata: {
      instanceType: 'x1.large',
      state: 'running',
      publicIpAddress: '198.51.100.10',
      metadataHttpTokens: 'optional',
      monitoringState: 'disabled',
      launchTime: new Date().toISOString(),
    },
    discoveredAt: new Date().toISOString(),
  });
  await ec2Repo.upsertDiscoveredResource({
    tenantId: TENANT,
    accountId: ACCOUNT,
    region: 'us-east-1',
    resourceType: 'VOLUME',
    resourceId: 'vol-api-risk',
    tags: [],
    status: 'ACTIVE',
    metadata: {
      encrypted: false,
      attachedInstanceIds: ['i-api-risk'],
    },
    discoveredAt: new Date().toISOString(),
  });

  const securityRepo = new MockEc2SecurityRepository();
  const service = new Ec2SecurityAnalysisApiService(
    awsAccounts,
    ec2Repo,
    securityRepo,
    securityRepo,
    securityRepo,
  );
  const membershipRepository = new InMemoryMembershipRepository();
  await seedMembership(membershipRepository, TENANT, 'security-analyst', TENANT_ROLES.SECURITY_ADMIN);

  const app = express();
  app.use(express.json());
  app.use(createIdentitySourceMiddleware('lambda-adapter'));
  app.use(
    '/api/v1',
    requireAnyRole(...ALL_AUTHENTICATED_ROLES),
    requireTenantContext(),
    createEc2SecurityRoutes({ ec2SecurityAnalysisApi: service, membershipRepository }),
  );

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('EC2 security analysis API (repository-backed)', () => {
  it('runs analysis from durable inventory and returns persisted recommendations', async () => {
    const analysis = await fetch(`${baseUrl}/analysis/ec2/security`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ accountId: ACCOUNT, regions: ['us-east-1'] }),
    });
    const analysisText = await analysis.text();
    assert.equal(analysis.status, 200, analysisText);
    const body = JSON.parse(analysisText) as {
      success: boolean;
      data: { summary: { instancesAnalyzed: number; securityScore: number } };
    };
    assert.equal(body.success, true);
    assert.equal(body.data.summary.instancesAnalyzed, 1);
    assert.ok(body.data.summary.securityScore >= 0);

    const recommendations = await fetch(
      `${baseUrl}/recommendations/ec2/security?accountId=${ACCOUNT}&region=us-east-1`,
      { headers },
    );
    assert.equal(recommendations.status, 200);
    const recommendationBody = (await recommendations.json()) as {
      data: { items: unknown[] };
    };
    assert.ok(recommendationBody.data.items.length > 0);

    const summary = await fetch(
      `${baseUrl}/security/ec2/summary?accountId=${ACCOUNT}&region=us-east-1`,
      { headers },
    );
    assert.equal(summary.status, 200);
    const summaryBody = (await summary.json()) as {
      data: { scope: string; complianceScore: number | null; governanceScore: number | null };
    };
    assert.equal(summaryBody.data.scope, 'region');
    assert.ok(
      summaryBody.data.complianceScore === null || summaryBody.data.complianceScore >= 0,
    );
  });

  it('rejects analysis without accountId', async () => {
    const response = await fetch(`${baseUrl}/analysis/ec2/security`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 422);
  });
});
