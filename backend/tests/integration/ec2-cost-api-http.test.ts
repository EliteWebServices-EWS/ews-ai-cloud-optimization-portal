import assert from 'node:assert/strict';
import express from 'express';
import { describe, it } from 'node:test';

import { createEc2CostRoutes } from '../../api/routes/ec2-cost.routes';
import {
  ALL_AUTHENTICATED_ROLES,
  createIdentitySourceMiddleware,
  requireAnyRole,
  requireTenantContext,
  TENANT_ROLES,
} from '../../auth';
import { InMemoryMembershipRepository } from '../../membership/membership.store';
import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import { Ec2CostAnalysisApiService } from '../../services/ec2-cost-analysis-api-service';
import {
  seedMembership,
  seedVerifiedAccount,
  withHttpServer,
} from './ec2-discovery-http.helpers';

const TENANT = 'tenant-ec2-cost';
const ACCOUNT = '572262081497';

async function jsonFetch(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = (await res.json()) as { data?: Record<string, unknown> };
  return { status: res.status, body };
}

function headers(_role: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-sisum-authenticated': 'true',
    'x-sisum-token-use': 'access',
    'x-sisum-client-id': 'test-client',
    'x-sisum-user-id': 'user-1',
    'x-sisum-user-email': 'user-1@example.com',
    'x-sisum-user-groups': 'admin',
    'x-sisum-tenant-id': TENANT,
  };
}

describe('EC2 cost API HTTP', () => {
  it('returns SUCCEEDED with zero instances for verified account', async () => {
    const awsAccounts = new MockAwsAccountRepository();
    await seedVerifiedAccount(awsAccounts, TENANT, ACCOUNT, 'us-east-1');

    const resources = new MockEc2CloudResourceRepository();
    const costRepo = new MockEc2CostRepository();
    let metricsInvoked = false;
    const service = new Ec2CostAnalysisApiService(
      awsAccounts,
      resources,
      costRepo,
      costRepo,
      undefined,
      (_region: string) => {
        metricsInvoked = true;
        return {
          collectMetrics: async () => [],
        };
      },
    );

    const membershipRepository = new InMemoryMembershipRepository();
    await seedMembership(membershipRepository, TENANT, 'user-1', TENANT_ROLES.TENANT_OWNER);

    const app = express();
    app.use(express.json());
    app.use(createIdentitySourceMiddleware('lambda-adapter'));
    app.use(requireAnyRole(...ALL_AUTHENTICATED_ROLES));
    app.use(requireTenantContext());
    app.use('/api/v1', createEc2CostRoutes({ ec2CostAnalysisApi: service, membershipRepository }));

    await withHttpServer(app, async (baseUrl) => {
      const { status, body } = await jsonFetch(`${baseUrl}/api/v1/analysis/ec2/cost`, {
        method: 'POST',
        headers: headers('tenant_owner'),
        body: JSON.stringify({
          accountId: ACCOUNT,
          regions: ['us-east-1'],
          observationDays: 14,
        }),
      });
      assert.equal(status, 200);
      assert.equal(body.data?.status, 'SUCCEEDED');
      assert.equal(body.data?.instancesFound, 0);
      assert.equal(body.data?.instancesEvaluated, 0);
      assert.equal(metricsInvoked, false);

      const list = await jsonFetch(
        `${baseUrl}/api/v1/recommendations/ec2/cost?accountId=${ACCOUNT}`,
        { headers: headers('viewer') },
      );
      assert.equal(list.status, 200);
      assert.equal((list.body.data as { items: unknown[] })?.items.length, 0);
    });
  });

  it('denies viewer from starting analysis', async () => {
    const awsAccounts = new MockAwsAccountRepository();
    const service = new Ec2CostAnalysisApiService(
      awsAccounts,
      new MockEc2CloudResourceRepository(),
      new MockEc2CostRepository(),
      new MockEc2CostRepository(),
    );
    const membershipRepository = new InMemoryMembershipRepository();
    await seedMembership(membershipRepository, TENANT, 'user-2', TENANT_ROLES.VIEWER);

    const app = express();
    app.use(express.json());
    app.use(createIdentitySourceMiddleware('lambda-adapter'));
    app.use(requireAnyRole(...ALL_AUTHENTICATED_ROLES));
    app.use(requireTenantContext());
    app.use('/api/v1', createEc2CostRoutes({ ec2CostAnalysisApi: service, membershipRepository }));

    await withHttpServer(app, async (baseUrl) => {
      const { status } = await jsonFetch(`${baseUrl}/api/v1/analysis/ec2/cost`, {
        method: 'POST',
        headers: {
          ...headers('viewer'),
          'x-sisum-user-groups': 'viewer',
          'x-sisum-user-id': 'user-2',
        },
        body: JSON.stringify({ accountId: ACCOUNT }),
      });
      assert.equal(status, 403);
    });
  });
});
