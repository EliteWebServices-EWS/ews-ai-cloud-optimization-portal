import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import express from 'express';

import { createEc2Routes } from '../../api/routes/ec2.routes';
import { RepositoryConflictError } from '../../database';
import {
  ALL_AUTHENTICATED_ROLES,
  createIdentitySourceMiddleware,
  requireAnyRole,
  requireTenantContext,
  TENANT_ROLES,
} from '../../auth';
import { InMemoryMembershipRepository } from '../../membership/membership.store';
import { Ec2DiscoveryApiService } from '../../services/ec2-discovery-api-service';
import {
  ACCOUNT_A,
  TENANT_A,
  emptyInventory,
  httpJson,
  inventoryWithInstance,
  mockClientFactory,
  seedMembership,
  seedVerifiedAccount,
  withHttpServer,
} from './ec2-discovery-http.helpers';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';
import { StsCredentialProvider } from '../../execution/adapters/sts';

class UpsertConflictOnSecondWriteRepository extends MockEc2CloudResourceRepository {
  private writes = 0;

  override async upsertDiscoveredResource(
    input: Parameters<MockEc2CloudResourceRepository['upsertDiscoveredResource']>[0],
  ) {
    this.writes += 1;
    if (this.writes >= 2) {
      throw new RepositoryConflictError('EC2 cloud resource version conflict.');
    }
    return super.upsertDiscoveredResource(input);
  }
}

function buildAppWithService(service: Pick<
  Ec2DiscoveryApiService,
  'startDiscovery' | 'listResources' | 'getResource' | 'getSummary'
>) {
  const membershipRepository = new InMemoryMembershipRepository();
  const app = express();
  app.use(express.json());
  app.use(createIdentitySourceMiddleware('lambda-adapter'));
  app.use(
    '/api/v1',
    requireAnyRole(...ALL_AUTHENTICATED_ROLES),
    requireTenantContext(),
    createEc2Routes({
      ec2DiscoveryApi: service as Ec2DiscoveryApiService,
      membershipRepository,
    }),
  );
  return { app, membershipRepository };
}

describe('EC2 discovery HTTP optimistic-lock conflicts', () => {
  before(() => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
  });
  after(() => {
    delete process.env.AUDIT_PERSISTENCE_ENABLED;
  });

  it('maps resource upsert conflict during discovery to HTTP 409 CONFLICT', async () => {
    const repo = new UpsertConflictOnSecondWriteRepository();
    const awsRepo = new MockAwsAccountRepository();
    const membershipRepository = new InMemoryMembershipRepository();
    const service = new Ec2DiscoveryApiService(
      awsRepo,
      repo,
      repo,
      new StsCredentialProvider({ stsClient: { send: async () => ({}) } as never, maxAttempts: 1 }),
      mockClientFactory({
        'us-east-1': {
          ...emptyInventory(),
          instances: [
            ...inventoryWithInstance('i-one').instances,
            ...inventoryWithInstance('i-two').instances,
          ],
        },
      }),
    );
    const app = express();
    app.use(express.json());
    app.use(createIdentitySourceMiddleware('lambda-adapter'));
    app.use(
      '/api/v1',
      requireAnyRole(...ALL_AUTHENTICATED_ROLES),
      requireTenantContext(),
      createEc2Routes({ ec2DiscoveryApi: service, membershipRepository }),
    );
    await seedMembership(membershipRepository, TENANT_A, 'owner-a', TENANT_ROLES.TENANT_OWNER);
    await seedVerifiedAccount(awsRepo, TENANT_A, ACCOUNT_A, 'us-east-1');
    await withHttpServer(app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'owner-a', tenantId: TENANT_A },
        {},
      );
      assert.equal(res.status, 409);
      const err = (res.body as { success: false; error: { code: string; stage?: string } }).error;
      assert.equal(err.code, 'CONFLICT');
      assert.equal(err.stage, 'ec2-api');
      assert.doesNotMatch(JSON.stringify(res.body), /ConditionalCheckFailed/);
      assert.doesNotMatch(JSON.stringify(res.body), /DynamoDB/);
    });
  });

  it('maps discovery-run conflict from listResources to HTTP 409', async () => {
    const stub = {
      startDiscovery: async () => {
        throw new RepositoryConflictError('EC2 discovery run version conflict.');
      },
      listResources: async () => {
        throw new RepositoryConflictError('EC2 discovery run version conflict.');
      },
      getResource: async () => {
        throw new RepositoryConflictError('EC2 cloud resource version conflict.');
      },
      getSummary: async () => ({
        totalResources: 0,
        instancesByState: {},
        instancesByRegion: {},
        instancesByInstanceType: {},
        resourcesByType: {},
        staleResourceCount: 0,
      }),
    };
    const { app, membershipRepository } = buildAppWithService(stub);
    await seedMembership(membershipRepository, TENANT_A, 'viewer-a', TENANT_ROLES.VIEWER);
    await withHttpServer(app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources?accountId=${ACCOUNT_A}`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      assert.equal(res.status, 409);
      assert.equal((res.body as { error: { code: string } }).error.code, 'CONFLICT');
    });
  });

  it('returns sanitized HTTP 500 without internal Error.message', async () => {
    const stub = {
      startDiscovery: async () => {
        throw new Error('Internal persistence failure');
      },
      listResources: async () => {
        throw new Error('Internal persistence failure');
      },
      getResource: async () => {
        throw new Error('unexpected');
      },
      getSummary: async () => ({
        totalResources: 0,
        instancesByState: {},
        instancesByRegion: {},
        instancesByInstanceType: {},
        resourcesByType: {},
        staleResourceCount: 0,
      }),
    };
    const { app, membershipRepository } = buildAppWithService(stub);
    await seedMembership(membershipRepository, TENANT_A, 'viewer-a', TENANT_ROLES.VIEWER);
    await withHttpServer(app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources?accountId=${ACCOUNT_A}`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      assert.equal(res.status, 500);
      assert.equal((res.body as { error: { code: string; stage?: string } }).error.code, 'ENGINE_ERROR');
      assert.equal((res.body as { error: { stage?: string } }).error.stage, 'ec2-api');
      assert.doesNotMatch(JSON.stringify(res.body), /Internal persistence failure/);
    });
  });
});
