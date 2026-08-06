import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TENANT_ROLES } from '../../auth';
import { RepositoryConflictError } from '../../database';
import { EC2_COST_RECOMMENDATION_TOKEN_MAX_LENGTH } from '../../repositories/ec2-cost-recommendation-pagination';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';
import { Ec2CostAnalysisApiService } from '../../services/ec2-cost-analysis-api-service';
import { EC2_COST_PUBLIC_INTERNAL_ERROR_MESSAGE } from '../../api/ec2-cost-api-error-handling';
import {
  buildEc2CostHttpApp,
  costIdentity,
  COST_ACCOUNT_A,
  COST_TENANT_A,
  httpJson,
  seedMembership,
  seedVerifiedAccount,
} from './ec2-cost-api-http.helpers';
import { withHttpServer } from './ec2-discovery-http.helpers';

const ANALYSIS_PATH = '/api/v1/analysis/ec2/cost';
const LIST_PATH = '/api/v1/recommendations/ec2/cost';

function assertInvalidRequest422(body: Record<string, unknown>): void {
  assert.equal((body as { error?: { code: string; stage?: string } }).error?.code, 'INVALID_REQUEST');
  assert.equal((body as { error?: { stage?: string } }).error?.stage, 'ec2-cost-api');
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /cloud-resource|DynamoDB|SisumCloudResources|validateCloudResource/i);
}

describe('EC2 cost API validation HTTP', () => {
  async function ownerContext() {
    const ctx = buildEc2CostHttpApp();
    await seedVerifiedAccount(ctx.awsRepo, COST_TENANT_A, COST_ACCOUNT_A, 'us-east-1');
    await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER);
    return ctx;
  }

  it('malformed accountId returns 422 INVALID_REQUEST, not 500', async () => {
    const ctx = await ownerContext();
    await withHttpServer(ctx.app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'POST',
        ANALYSIS_PATH,
        costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
        { accountId: 'not-an-account' },
      );
      assert.equal(res.status, 422);
      assertInvalidRequest422(res.body);
    });
  });

  it('malformed region returns 422 INVALID_REQUEST, not 500', async () => {
    const ctx = await ownerContext();
    await withHttpServer(ctx.app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'POST',
        ANALYSIS_PATH,
        costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
        { accountId: COST_ACCOUNT_A, regions: ['not-a-region'] },
      );
      assert.equal(res.status, 422);
      assertInvalidRequest422(res.body);
    });
  });

  it('missing accountId returns 422', async () => {
    const ctx = await ownerContext();
    await withHttpServer(ctx.app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'POST',
        ANALYSIS_PATH,
        costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
        {},
      );
      assert.equal(res.status, 422);
      assertInvalidRequest422(res.body);
    });
  });

  it('invalid filter enum returns 422', async () => {
    const ctx = buildEc2CostHttpApp();
    await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER);
    await withHttpServer(ctx.app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'GET',
        `${LIST_PATH}?accountId=${COST_ACCOUNT_A}&severity=CRITICAL`,
        costIdentity(COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER),
      );
      assert.equal(res.status, 422);
      assertInvalidRequest422(res.body);
    });
  });

  it('invalid limit returns 422', async () => {
    const ctx = buildEc2CostHttpApp();
    await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER);
    await withHttpServer(ctx.app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'GET',
        `${LIST_PATH}?accountId=${COST_ACCOUNT_A}&limit=0`,
        costIdentity(COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER),
      );
      assert.equal(res.status, 422);
      assertInvalidRequest422(res.body);
    });
  });

  it('oversized nextToken returns 422', async () => {
    const ctx = buildEc2CostHttpApp();
    await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER);
    const token = 'a'.repeat(EC2_COST_RECOMMENDATION_TOKEN_MAX_LENGTH + 10);
    await withHttpServer(ctx.app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'GET',
        `${LIST_PATH}?accountId=${COST_ACCOUNT_A}&nextToken=${encodeURIComponent(token)}`,
        costIdentity(COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER),
      );
      assert.equal(res.status, 422);
      assertInvalidRequest422(res.body);
    });
  });

  it('unknown service failure returns sanitized 500 ENGINE_ERROR', async () => {
    const stub = {
      startCostAnalysis: async () => {
        throw new Error('internal persistence table failure secret');
      },
      listRecommendations: async () => ({ items: [], nextToken: undefined }),
      getRecommendation: async () => {
        throw new Error('nope');
      },
    } as unknown as Ec2CostAnalysisApiService;
    const ctx = buildEc2CostHttpApp({ service: stub });
    await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER);
    await withHttpServer(ctx.app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'POST',
        ANALYSIS_PATH,
        costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
        { accountId: COST_ACCOUNT_A },
      );
      assert.equal(res.status, 500);
      assert.equal((res.body as { error: { code: string; message: string } }).error.code, 'ENGINE_ERROR');
      assert.equal(
        (res.body as { error: { message: string } }).error.message,
        EC2_COST_PUBLIC_INTERNAL_ERROR_MESSAGE,
      );
      assert.doesNotMatch(JSON.stringify(res.body), /persistence table failure secret/);
    });
  });

  it('RepositoryConflictError still returns 409 CONFLICT', async () => {
    class ConflictCostRepo extends MockEc2CostRepository {
      override async completeRun(): Promise<never> {
        throw new RepositoryConflictError('version conflict secret');
      }
    }
    const awsRepo = new MockAwsAccountRepository();
    const resources = new MockEc2CloudResourceRepository();
    const costRepo = new ConflictCostRepo();
    const service = new Ec2CostAnalysisApiService(awsRepo, resources, costRepo, costRepo);
    const ctx = buildEc2CostHttpApp({ awsRepo, resources, costRepo, service });
    await seedVerifiedAccount(ctx.awsRepo, COST_TENANT_A, COST_ACCOUNT_A, 'us-east-1');
    await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER);
    await withHttpServer(ctx.app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'POST',
        ANALYSIS_PATH,
        costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
        { accountId: COST_ACCOUNT_A },
      );
      assert.equal(res.status, 409);
      assert.equal((res.body as { error: { code: string } }).error.code, 'CONFLICT');
    });
  });
});
