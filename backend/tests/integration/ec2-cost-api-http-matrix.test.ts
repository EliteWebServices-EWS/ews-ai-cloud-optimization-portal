import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TENANT_ROLES } from '../../auth';
import { RepositoryConflictError } from '../../database';
import { buildEc2CostFindingKey } from '../../database/cloud-resources/ec2-cost-keys';
import { StsCredentialProvider } from '../../execution/adapters/sts';
import { AppError } from '../../shared/utils';
import { EC2_COST_MAX_OBSERVATION_DAYS, EC2_COST_MIN_OBSERVATION_DAYS } from '../../cloud-intelligence/ec2-cost/ec2-cost-limits';
import { stoppedWithStorageRule } from '../../cloud-intelligence/ec2-cost/ec2-cost-rules';
import type { Ec2CostRecommendationRecord } from '../../cloud-intelligence/ec2-cost/ec2-cost-models';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import { encodeEc2CostRecommendationNextToken } from '../../repositories/ec2-cost-recommendation-pagination';
import { Ec2CostAnalysisApiService } from '../../services/ec2-cost-analysis-api-service';
import { EC2_COST_PUBLIC_INTERNAL_ERROR_MESSAGE } from '../../api/ec2-cost-api-error-handling';
import {
  assertNoSensitiveFields,
  buildEc2CostHttpApp,
  captureAuditEvents,
  costIdentity,
  COST_ACCOUNT_A,
  COST_ACCOUNT_B,
  COST_TENANT_A,
  COST_TENANT_B,
  httpJson,
  seedMembership,
  seedRecommendation,
  seedVerifiedAccount,
} from './ec2-cost-api-http.helpers';
import { dataOf, identityHeaders, withHttpServer } from './ec2-discovery-http.helpers';
import { cloudResourceAccountPartitionKey } from '../../database/cloud-resources/cloud-resource-keys';
import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';

const ANALYSIS_PATH = '/api/v1/analysis/ec2/cost';
const LIST_PATH = '/api/v1/recommendations/ec2/cost';

function noopMetrics() {
  return (_region: string) => ({
    collectMetrics: async () => [],
  });
}

function makeAnalysisService(
  awsRepo: MockAwsAccountRepository,
  resources: MockEc2CloudResourceRepository,
  costRepo: MockEc2CostRepository,
  options?: {
    credentialProvider?: StsCredentialProvider;
    metricsFactory?: ReturnType<typeof noopMetrics>;
  },
): Ec2CostAnalysisApiService {
  return new Ec2CostAnalysisApiService(
    awsRepo,
    resources,
    costRepo,
    costRepo,
    options?.credentialProvider,
    options?.metricsFactory ?? noopMetrics(),
  );
}

function baseRec(overrides: Partial<Ec2CostRecommendationRecord>): Ec2CostRecommendationRecord {
  const region = overrides.region ?? 'us-east-1';
  const resourceId = overrides.resourceId ?? 'i-1';
  const category = overrides.category ?? 'STOPPED_WITH_STORAGE';
  const ruleVersion = overrides.ruleVersion ?? stoppedWithStorageRule.ruleVersion;
  const tenantId = overrides.tenantId ?? COST_TENANT_A;
  const accountId = overrides.accountId ?? COST_ACCOUNT_A;
  const findingKey =
    overrides.findingKey ??
    buildEc2CostFindingKey({ tenantId, accountId, region, resourceId, category, ruleVersion });
  return {
    recommendationId: overrides.recommendationId ?? 'ec2rec-matrix-1',
    tenantId,
    accountId,
    region,
    service: 'ec2',
    resourceType: 'INSTANCE',
    resourceId,
    category,
    severity: 'MEDIUM',
    confidenceScore: 0.5,
    confidenceLevel: 'MEDIUM',
    title: 'title',
    summary: 'summary',
    businessJustification: 'biz',
    recommendedAction: 'act',
    evidenceSummary: 'evidence',
    observedValues: {},
    thresholds: {},
    pricingStatus: 'UNAVAILABLE',
    analysisRunId: 'run-old',
    ruleId: stoppedWithStorageRule.ruleId,
    ruleVersion,
    lifecycleStatus: 'OPEN',
    findingKey,
    firstDetectedAt: '2026-01-01T00:00:00.000Z',
    lastDetectedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function seedRunningInstance(
  resources: MockEc2CloudResourceRepository,
  instanceId: string,
  region = 'us-east-1',
) {
  await resources.upsertDiscoveredResource({
    tenantId: COST_TENANT_A,
    accountId: COST_ACCOUNT_A,
    region,
    resourceType: 'INSTANCE',
    resourceId: instanceId,
    tags: [],
    status: 'ACTIVE',
    metadata: { state: 'running', instanceType: 't3.micro' },
    discoveredAt: new Date().toISOString(),
  });
}

describe('EC2 cost API HTTP matrix', () => {
  describe('authentication and RBAC', () => {
    for (const role of [
      TENANT_ROLES.TENANT_OWNER,
      TENANT_ROLES.TENANT_ADMIN,
      TENANT_ROLES.ANALYST,
    ] as const) {
      it(`${role} can POST cost analysis`, async () => {
        const ctx = buildEc2CostHttpApp();
        await seedVerifiedAccount(ctx.awsRepo, COST_TENANT_A, COST_ACCOUNT_A, 'us-east-1');
        await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'u-start', role);
        await withHttpServer(ctx.app, async (baseUrl) => {
          const res = await httpJson(
            baseUrl,
            'POST',
            ANALYSIS_PATH,
            costIdentity(COST_TENANT_A, 'u-start', role),
            { accountId: COST_ACCOUNT_A },
          );
          assert.equal(res.status, 200);
        });
      });
    }

    for (const role of [TENANT_ROLES.VIEWER, TENANT_ROLES.AUDITOR, TENANT_ROLES.SECURITY_ADMIN] as const) {
      it(`${role} receives 403 starting analysis`, async () => {
        const ctx = buildEc2CostHttpApp();
        await seedVerifiedAccount(ctx.awsRepo, COST_TENANT_A, COST_ACCOUNT_A, 'us-east-1');
        await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'u-deny', role);
        await withHttpServer(ctx.app, async (baseUrl) => {
          const res = await httpJson(
            baseUrl,
            'POST',
            ANALYSIS_PATH,
            costIdentity(COST_TENANT_A, 'u-deny', role),
            { accountId: COST_ACCOUNT_A },
          );
          assert.equal(res.status, 403);
        });
      });
    }

    it('missing membership receives 403', async () => {
      const ctx = buildEc2CostHttpApp();
      await seedVerifiedAccount(ctx.awsRepo, COST_TENANT_A, COST_ACCOUNT_A, 'us-east-1');
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'POST',
          ANALYSIS_PATH,
          costIdentity(COST_TENANT_A, 'no-member', TENANT_ROLES.TENANT_OWNER),
        );
        assert.equal(res.status, 403);
      });
    });

    it('unauthenticated request receives 401', async () => {
      const ctx = buildEc2CostHttpApp();
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'POST',
          ANALYSIS_PATH,
          { tenantId: COST_TENANT_A, userId: 'x', authenticated: false },
          { accountId: COST_ACCOUNT_A },
        );
        assert.equal(res.status, 401);
      });
    });
  });

  describe('account and tenant isolation', () => {
    it('missing account returns safe 404', async () => {
      const ctx = buildEc2CostHttpApp();
      await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER);
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'POST',
          ANALYSIS_PATH,
          costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
          { accountId: COST_ACCOUNT_A },
        );
        assert.equal(res.status, 404);
        assertNoSensitiveFields(res.body);
      });
    });

    it('cross-tenant account returns the same safe 404', async () => {
      const ctx = buildEc2CostHttpApp();
      await seedVerifiedAccount(ctx.awsRepo, COST_TENANT_B, COST_ACCOUNT_A, 'us-east-1');
      await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER);
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'POST',
          ANALYSIS_PATH,
          costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
          { accountId: COST_ACCOUNT_A },
        );
        assert.equal(res.status, 404);
      });
    });

    it('unverified account is rejected safely', async () => {
      const ctx = buildEc2CostHttpApp();
      await ctx.awsRepo.create({
        tenantId: COST_TENANT_A,
        accountId: COST_ACCOUNT_A,
        roleArn: `arn:aws:iam::${COST_ACCOUNT_A}:role/SisumReadOnlyIntegrationRole`,
        externalId: 'ext-test-value-never-logged',
        region: 'us-east-1',
        status: 'PENDING',
        verificationStatus: 'NOT_STARTED',
        metadata: {},
      });
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
        assert.equal((res.body as { error: { code: string } }).error.code, 'AWS_ACCOUNT_NOT_VERIFIED');
        assertNoSensitiveFields(res.body);
      });
    });

    it('tenantId in body does not override trusted tenant context', async () => {
      const awsRepo = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      const costRepo = new MockEc2CostRepository();
      const service = new Ec2CostAnalysisApiService(
        awsRepo,
        resources,
        costRepo,
        costRepo,
        undefined,
        noopMetrics(),
      );
      const ctx = buildEc2CostHttpApp({ service, resources, costRepo, awsRepo });
      await seedVerifiedAccount(ctx.awsRepo, COST_TENANT_A, COST_ACCOUNT_A, 'us-east-1');
      await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER);
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'POST',
          ANALYSIS_PATH,
          costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
          { accountId: COST_ACCOUNT_A, tenantId: COST_TENANT_B },
        );
        assert.equal(res.status, 200);
        const items = (await costRepo.listRecommendations({ tenantId: COST_TENANT_A, accountId: COST_ACCOUNT_A, limit: 5 }))
          .items;
        assert.ok(items.every((i) => i.tenantId === COST_TENANT_A));
      });
    });

    it('another tenant cannot list recommendations for tenant A account', async () => {
      const ctx = buildEc2CostHttpApp();
      seedRecommendation(ctx.costRepo, baseRec({ recommendationId: 'rec-a' }));
      await seedMembership(ctx.membershipRepository, COST_TENANT_B, 'viewer-b', TENANT_ROLES.VIEWER);
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}?accountId=${COST_ACCOUNT_A}`,
          costIdentity(COST_TENANT_B, 'viewer-b', TENANT_ROLES.VIEWER),
        );
        assert.equal(res.status, 200);
        assert.equal((dataOf(res.body).items as unknown[]).length, 0);
      });
    });

    it('cross-tenant get-one returns safe 404', async () => {
      const ctx = buildEc2CostHttpApp();
      seedRecommendation(ctx.costRepo, baseRec({ recommendationId: 'rec-secret' }));
      await seedMembership(ctx.membershipRepository, COST_TENANT_B, 'viewer-b', TENANT_ROLES.VIEWER);
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}/rec-secret?accountId=${COST_ACCOUNT_A}`,
          costIdentity(COST_TENANT_B, 'viewer-b', TENANT_ROLES.VIEWER),
        );
        assert.equal(res.status, 404);
      });
    });
  });

  describe('validation', () => {
    async function withOwnerApp() {
      const ctx = buildEc2CostHttpApp();
      await seedVerifiedAccount(ctx.awsRepo, COST_TENANT_A, COST_ACCOUNT_A, 'us-east-1');
      await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER);
      return ctx;
    }

    it('rejects missing accountId', async () => {
      const ctx = await withOwnerApp();
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'POST',
          ANALYSIS_PATH,
          costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
          {},
        );
        assert.equal(res.status, 422);
      });
    });

    it('rejects malformed accountId', async () => {
      const ctx = await withOwnerApp();
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'POST',
          ANALYSIS_PATH,
          costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
          { accountId: 'not-an-account' },
        );
        assert.equal(res.status, 422);
        assert.equal((res.body as { error: { code: string; stage: string } }).error.code, 'INVALID_REQUEST');
        assert.equal((res.body as { error: { stage: string } }).error.stage, 'ec2-cost-api');
        assert.doesNotMatch(JSON.stringify(res.body), /Invalid AWS accountId/i);
      });
    });

    it('rejects malformed region', async () => {
      const ctx = await withOwnerApp();
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'POST',
          ANALYSIS_PATH,
          costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
          { accountId: COST_ACCOUNT_A, regions: ['not-a-region'] },
        );
        assert.equal(res.status, 422);
        assert.equal((res.body as { error: { code: string } }).error.code, 'INVALID_REQUEST');
      });
    });

    it('deduplicates duplicate regions', async () => {
      const ctx = await withOwnerApp();
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'POST',
          ANALYSIS_PATH,
          costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
          { accountId: COST_ACCOUNT_A, regions: ['us-east-1', 'us-east-1'] },
        );
        assert.equal(res.status, 200);
        assert.deepEqual(dataOf(res.body).regions, ['us-east-1']);
      });
    });

    it('rejects more than 3 regions', async () => {
      const ctx = await withOwnerApp();
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'POST',
          ANALYSIS_PATH,
          costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
          {
            accountId: COST_ACCOUNT_A,
            regions: ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'],
          },
        );
        assert.equal(res.status, 422);
      });
    });

    it('rejects observationDays below minimum', async () => {
      const ctx = await withOwnerApp();
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'POST',
          ANALYSIS_PATH,
          costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
          { accountId: COST_ACCOUNT_A, observationDays: EC2_COST_MIN_OBSERVATION_DAYS - 1 },
        );
        assert.equal(res.status, 422);
      });
    });

    it('rejects observationDays above maximum', async () => {
      const ctx = await withOwnerApp();
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'POST',
          ANALYSIS_PATH,
          costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
          { accountId: COST_ACCOUNT_A, observationDays: EC2_COST_MAX_OBSERVATION_DAYS + 1 },
        );
        assert.equal(res.status, 422);
      });
    });

    it('rejects malformed request body', async () => {
      const ctx = await withOwnerApp();
      await withHttpServer(ctx.app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}${ANALYSIS_PATH}`, {
          method: 'POST',
          headers: identityHeaders(costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER)),
          body: 'not-json',
        });
        assert.equal(response.status, 400);
      });
    });

    it('rejects malformed pagination token with 422', async () => {
      const ctx = await withOwnerApp();
      await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER);
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}?accountId=${COST_ACCOUNT_A}&nextToken=%%%invalid%%%`,
          costIdentity(COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER),
        );
        assert.equal(res.status, 422);
      });
    });

    it('rejects pagination token for another tenant', async () => {
      const ctx = buildEc2CostHttpApp();
      seedRecommendation(ctx.costRepo, baseRec({ recommendationId: 'rec-page' }));
      const pk = cloudResourceAccountPartitionKey(COST_TENANT_A, COST_ACCOUNT_A);
      const token = encodeEc2CostRecommendationNextToken(
        { tenantId: COST_TENANT_A, accountId: COST_ACCOUNT_A, limit: 1 },
        { pk, sk: 'rec-page' },
      );
      assert.ok(token);
      await seedMembership(ctx.membershipRepository, COST_TENANT_B, 'viewer', TENANT_ROLES.VIEWER);
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}?accountId=${COST_ACCOUNT_A}&nextToken=${encodeURIComponent(token!)}`,
          costIdentity(COST_TENANT_B, 'viewer', TENANT_ROLES.VIEWER),
        );
        assert.equal(res.status, 422);
      });
    });

    it('rejects pagination token for another account', async () => {
      const ctx = buildEc2CostHttpApp();
      const pk = cloudResourceAccountPartitionKey(COST_TENANT_A, COST_ACCOUNT_A);
      const token = encodeEc2CostRecommendationNextToken(
        { tenantId: COST_TENANT_A, accountId: COST_ACCOUNT_A, limit: 1 },
        { pk, sk: 'rec-page' },
      );
      assert.ok(token);
      await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER);
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}?accountId=${COST_ACCOUNT_B}&nextToken=${encodeURIComponent(token!)}`,
          costIdentity(COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER),
        );
        assert.equal(res.status, 422);
      });
    });

    it('rejects pagination token when list filters differ', async () => {
      const ctx = buildEc2CostHttpApp();
      seedRecommendation(ctx.costRepo, baseRec({ recommendationId: 'rec-filter', region: 'us-east-1' }));
      const pk = cloudResourceAccountPartitionKey(COST_TENANT_A, COST_ACCOUNT_A);
      const token = encodeEc2CostRecommendationNextToken(
        { tenantId: COST_TENANT_A, accountId: COST_ACCOUNT_A, region: 'us-east-1', limit: 1 },
        { pk, sk: 'rec-filter' },
      );
      assert.ok(token);
      await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER);
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}?accountId=${COST_ACCOUNT_A}&region=us-west-2&nextToken=${encodeURIComponent(token!)}`,
          costIdentity(COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER),
        );
        assert.equal(res.status, 422);
      });
    });
  });

  describe('analysis behavior', () => {
    it('zero instances returns 200 SUCCEEDED without CloudWatch calls', async () => {
      let metricsCalls = 0;
      const awsRepo = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      const costRepo = new MockEc2CostRepository();
      const ctx = buildEc2CostHttpApp({
        awsRepo,
        resources,
        costRepo,
        service: makeAnalysisService(awsRepo, resources, costRepo, {
          metricsFactory: () => {
            metricsCalls += 1;
            return { collectMetrics: async () => [] };
          },
        }),
      });
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
        assert.equal(res.status, 200);
        const data = dataOf(res.body);
        assert.equal(data.status, 'SUCCEEDED');
        assert.equal(data.instancesFound, 0);
        assert.equal(data.instancesEvaluated, 0);
        assert.equal(metricsCalls, 0);
        assertNoSensitiveFields(res.body);
      });
    });

    it('successful analysis returns summary only', async () => {
      const awsRepo = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      await seedRunningInstance(resources, 'i-run');
      const costRepo = new MockEc2CostRepository();
      const ctx = buildEc2CostHttpApp({
        awsRepo,
        resources,
        costRepo,
        service: makeAnalysisService(awsRepo, resources, costRepo),
      });
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
        const blob = JSON.stringify(res.body);
        assert.equal(res.status, 200);
        assert.doesNotMatch(blob, /MetricDataResults|Timestamps|Values/i);
      });
    });

    it('PARTIAL metric result returns PARTIAL and does not resolve OPEN recommendations', async () => {
      const awsRepo = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      await seedRunningInstance(resources, 'i-east', 'us-east-1');
      await seedRunningInstance(resources, 'i-west', 'us-west-2');
      const costRepo = new MockEc2CostRepository();
      costRepo.seedRecommendation(
        baseRec({ resourceId: 'i-stale', recommendationId: 'rec-open-partial' }),
      );
      const ctx = buildEc2CostHttpApp({
        awsRepo,
        resources,
        costRepo,
        service: makeAnalysisService(awsRepo, resources, costRepo, {
          metricsFactory: (region: string) => ({
            collectMetrics: async () => {
              if (region === 'us-west-2') {
                throw Object.assign(new Error('denied-secret'), { name: 'AccessDenied' });
              }
              return [];
            },
          }),
        }),
      });
      await seedVerifiedAccount(ctx.awsRepo, COST_TENANT_A, COST_ACCOUNT_A, 'us-east-1');
      await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER);
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'POST',
          ANALYSIS_PATH,
          costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
          { accountId: COST_ACCOUNT_A, regions: ['us-east-1', 'us-west-2'] },
        );
        assert.equal(res.status, 200);
        assert.equal(dataOf(res.body).status, 'PARTIAL');
        assert.equal(dataOf(res.body).recommendationsResolved, 0);
        const stillOpen = await costRepo.getRecommendation(COST_TENANT_A, COST_ACCOUNT_A, 'rec-open-partial');
        assert.equal(stillOpen?.lifecycleStatus, 'OPEN');
      });
    });

    it('FAILED analysis does not resolve recommendations', async () => {
      const awsRepo = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      await seedRunningInstance(resources, 'i-fail');
      const costRepo = new MockEc2CostRepository();
      costRepo.seedRecommendation(baseRec({ recommendationId: 'rec-open-failed' }));
      const ctx = buildEc2CostHttpApp({
        awsRepo,
        resources,
        costRepo,
        service: makeAnalysisService(awsRepo, resources, costRepo, {
          metricsFactory: () => ({
            collectMetrics: async () => {
              throw Object.assign(new Error('throttle-secret'), { name: 'ThrottlingException' });
            },
          }),
        }),
      });
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
        assert.equal(res.status, 200);
        assert.equal(dataOf(res.body).status, 'FAILED');
        assert.equal(dataOf(res.body).recommendationsResolved, 0);
      });
    });

    it('SUCCEEDED run can resolve absent OPEN recommendation', async () => {
      const awsRepo = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      await seedRunningInstance(resources, 'i-only');
      const costRepo = new MockEc2CostRepository();
      costRepo.seedRecommendation(
        baseRec({ resourceId: 'i-gone', recommendationId: 'rec-to-resolve' }),
      );
      const ctx = buildEc2CostHttpApp({
        awsRepo,
        resources,
        costRepo,
        service: makeAnalysisService(awsRepo, resources, costRepo),
      });
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
        assert.equal(res.status, 200);
        assert.equal(dataOf(res.body).status, 'SUCCEEDED');
        assert.ok(Number(dataOf(res.body).recommendationsResolved) >= 1);
      });
    });

    it('rejects more than 100 eligible instances', async () => {
      const resources = new MockEc2CloudResourceRepository();
      for (let i = 0; i < 101; i += 1) {
        await seedRunningInstance(resources, `i-${i}`);
      }
      const ctx = buildEc2CostHttpApp({ resources });
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
        assert.equal(res.status, 422);
      });
    });
  });

  describe('error sanitization', () => {
    it('AssumeRole failure is sanitized in warnings', async () => {
      const awsRepo = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      await seedRunningInstance(resources, 'i-sts');
      const failingSts = new StsCredentialProvider({
        stsClient: {
          send: async () => {
            throw Object.assign(new Error('sts-secret-detail'), { name: 'AccessDenied' });
          },
        } as never,
        maxAttempts: 1,
      });
      const costRepo = new MockEc2CostRepository();
      const ctx = buildEc2CostHttpApp({
        awsRepo,
        resources,
        costRepo,
        service: makeAnalysisService(awsRepo, resources, costRepo, {
          credentialProvider: failingSts,
        }),
      });
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
        assert.equal(res.status, 200);
        const blob = JSON.stringify(res.body);
        assert.doesNotMatch(blob, /sts-secret-detail/);
        assertNoSensitiveFields(res.body);
      });
    });

    it('CloudWatch AccessDenied and throttling are sanitized in warnings', async () => {
      const awsRepo = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      await seedRunningInstance(resources, 'i-cw');
      const costRepo = new MockEc2CostRepository();
      const ctx = buildEc2CostHttpApp({
        awsRepo,
        resources,
        costRepo,
        service: makeAnalysisService(awsRepo, resources, costRepo, {
          metricsFactory: () => ({
            collectMetrics: async () => {
              throw Object.assign(new Error('cw-secret'), { name: 'AccessDenied' });
            },
          }),
        }),
      });
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
        const warnings = JSON.stringify(dataOf(res.body).warnings ?? []);
        assert.match(warnings, /CLOUDWATCH_ACCESS_DENIED/);
        assert.doesNotMatch(warnings, /cw-secret/);
      });
    });

    it('RepositoryConflictError returns 409 CONFLICT', async () => {
      class ConflictCostRepo extends MockEc2CostRepository {
        override async completeRun(): Promise<never> {
          throw new RepositoryConflictError('version conflict secret');
        }
      }
      const costRepo = new ConflictCostRepo();
      const awsRepo = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      const ctx = buildEc2CostHttpApp({
        awsRepo,
        resources,
        costRepo,
        service: makeAnalysisService(awsRepo, resources, costRepo),
      });
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
        assert.doesNotMatch(JSON.stringify(res.body), /version conflict secret/);
      });
    });

    it('unknown Error returns fixed 500 ENGINE_ERROR without original message', async () => {
      const stub = {
        startCostAnalysis: async () => {
          throw new Error('super-secret-engine-detail');
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
        assert.doesNotMatch(JSON.stringify(res.body), /super-secret-engine-detail/);
        assertNoSensitiveFields(res.body);
      });
    });

    it('CloudWatch throttling maps to retryable code in warnings', async () => {
      const awsRepo = new MockAwsAccountRepository();
      const resources = new MockEc2CloudResourceRepository();
      await seedRunningInstance(resources, 'i-throttle');
      const costRepo = new MockEc2CostRepository();
      const ctx = buildEc2CostHttpApp({
        awsRepo,
        resources,
        costRepo,
        service: makeAnalysisService(awsRepo, resources, costRepo, {
          metricsFactory: () => ({
            collectMetrics: async () => {
              throw Object.assign(new Error('throttle-secret'), { name: 'ThrottlingException' });
            },
          }),
        }),
      });
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
        const warnings = JSON.stringify(dataOf(res.body).warnings ?? []);
        assert.match(warnings, /CLOUDWATCH_THROTTLED/);
        assert.doesNotMatch(warnings, /throttle-secret/);
      });
    });
  });

  describe('recommendation list and get', () => {
    it('list requires accountId', async () => {
      const ctx = buildEc2CostHttpApp();
      await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER);
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'GET',
          LIST_PATH,
          costIdentity(COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER),
        );
        assert.equal(res.status, 422);
      });
    });

    it('list filters and pagination', async () => {
      const ctx = buildEc2CostHttpApp();
      seedRecommendation(
        ctx.costRepo,
        baseRec({
          recommendationId: 'rec-east',
          region: 'us-east-1',
          category: 'STOPPED_WITH_STORAGE',
          severity: 'HIGH',
          confidenceLevel: 'HIGH',
          lifecycleStatus: 'OPEN',
          resourceId: 'i-east',
        }),
      );
      seedRecommendation(
        ctx.costRepo,
        baseRec({
          recommendationId: 'rec-west',
          region: 'us-west-2',
          category: 'REVIEW_DOWNSIZE',
          severity: 'LOW',
          confidenceLevel: 'LOW',
          lifecycleStatus: 'ACKNOWLEDGED',
          resourceId: 'i-west',
        }),
      );
      await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER);
      await withHttpServer(ctx.app, async (baseUrl) => {
        const id = costIdentity(COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER);
        const byRegion = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}?accountId=${COST_ACCOUNT_A}&region=us-east-1`,
          id,
        );
        assert.equal((dataOf(byRegion.body).items as unknown[]).length, 1);

        const byCategory = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}?accountId=${COST_ACCOUNT_A}&category=REVIEW_DOWNSIZE`,
          id,
        );
        assert.equal((dataOf(byCategory.body).items as unknown[]).length, 1);

        const bySeverity = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}?accountId=${COST_ACCOUNT_A}&severity=HIGH`,
          id,
        );
        assert.equal((dataOf(bySeverity.body).items as unknown[]).length, 1);

        const byConfidence = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}?accountId=${COST_ACCOUNT_A}&confidenceLevel=LOW`,
          id,
        );
        assert.equal((dataOf(byConfidence.body).items as unknown[]).length, 1);

        const byLifecycle = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}?accountId=${COST_ACCOUNT_A}&lifecycleStatus=ACKNOWLEDGED`,
          id,
        );
        assert.equal((dataOf(byLifecycle.body).items as unknown[]).length, 1);

        const byResource = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}?accountId=${COST_ACCOUNT_A}&resourceId=i-east`,
          id,
        );
        assert.equal((dataOf(byResource.body).items as unknown[]).length, 1);

        const page1 = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}?accountId=${COST_ACCOUNT_A}&limit=1`,
          id,
        );
        const token = dataOf(page1.body).nextToken as string | undefined;
        assert.ok(token);
        const page2 = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}?accountId=${COST_ACCOUNT_A}&limit=1&nextToken=${encodeURIComponent(token)}`,
          id,
        );
        const ids = [
          ...((dataOf(page1.body).items as { recommendationId: string }[]) ?? []),
          ...((dataOf(page2.body).items as { recommendationId: string }[]) ?? []),
        ].map((r) => r.recommendationId);
        assert.equal(new Set(ids).size, 2);
      });
    });

    it('get-one returns tenant-scoped recommendation and 404 when missing', async () => {
      const ctx = buildEc2CostHttpApp();
      seedRecommendation(ctx.costRepo, baseRec({ recommendationId: 'rec-get' }));
      await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER);
      await withHttpServer(ctx.app, async (baseUrl) => {
        const ok = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}/rec-get?accountId=${COST_ACCOUNT_A}`,
          costIdentity(COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER),
        );
        assert.equal(ok.status, 200);
        assert.equal((dataOf(ok.body) as { recommendationId: string }).recommendationId, 'rec-get');

        const missing = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}/missing?accountId=${COST_ACCOUNT_A}`,
          costIdentity(COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER),
        );
        assert.equal(missing.status, 404);
      });
    });

    it('static list route is not swallowed by dynamic recommendationId route', async () => {
      const ctx = buildEc2CostHttpApp();
      await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER);
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'GET',
          `${LIST_PATH}?accountId=${COST_ACCOUNT_A}`,
          costIdentity(COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER),
        );
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(dataOf(res.body).items));
      });
    });
  });

  describe('audit', () => {
    it('emits cost analysis and recommendation audit events without secrets', async () => {
      const audit = captureAuditEvents();
      try {
        const awsRepo = new MockAwsAccountRepository();
        const resources = new MockEc2CloudResourceRepository();
        await seedRunningInstance(resources, 'i-audit');
        const costRepo = new MockEc2CostRepository();
        const ctx = buildEc2CostHttpApp({
          awsRepo,
          resources,
          costRepo,
          service: makeAnalysisService(awsRepo, resources, costRepo),
        });
        await seedVerifiedAccount(ctx.awsRepo, COST_TENANT_A, COST_ACCOUNT_A, 'us-east-1');
        await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER);
        await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER);
        seedRecommendation(costRepo, baseRec({ recommendationId: 'rec-audit' }));

        await withHttpServer(ctx.app, async (baseUrl) => {
          await httpJson(
            baseUrl,
            'POST',
            ANALYSIS_PATH,
            costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
            { accountId: COST_ACCOUNT_A },
          );
          await httpJson(
            baseUrl,
            'GET',
            `${LIST_PATH}?accountId=${COST_ACCOUNT_A}`,
            costIdentity(COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER),
          );
          await httpJson(
            baseUrl,
            'GET',
            `${LIST_PATH}/rec-audit?accountId=${COST_ACCOUNT_A}`,
            costIdentity(COST_TENANT_A, 'viewer', TENANT_ROLES.VIEWER),
          );
        });

        const blob = audit.events.join('\n');
        assert.match(blob, /ec2\.cost_analysis_started/);
        assert.match(blob, /ec2\.cost_analysis_succeeded/);
        assert.match(blob, /ec2\.cost_recommendations_listed/);
        assert.match(blob, /ec2\.cost_recommendation_viewed/);
        assert.doesNotMatch(blob, /MetricDataResults|ext-test-value-never-logged|fake-secret/i);
      } finally {
        audit.restore();
      }
    });

    it('emits partial and failed analysis audit events', async () => {
      const audit = captureAuditEvents();
      try {
        const awsRepo = new MockAwsAccountRepository();
        const resources = new MockEc2CloudResourceRepository();
        await seedRunningInstance(resources, 'i-p', 'us-east-1');
        await seedRunningInstance(resources, 'i-p2', 'us-west-2');
        const costRepo = new MockEc2CostRepository();
        const ctx = buildEc2CostHttpApp({
          awsRepo,
          resources,
          costRepo,
          service: makeAnalysisService(awsRepo, resources, costRepo, {
            metricsFactory: (region: string) => ({
              collectMetrics: async () => {
                if (region === 'us-west-2') {
                  throw new AppError('CLOUDWATCH_ACCESS_DENIED', 'sanitized', 403);
                }
                return [];
              },
            }),
          }),
        });
        await seedVerifiedAccount(ctx.awsRepo, COST_TENANT_A, COST_ACCOUNT_A, 'us-east-1');
        await seedMembership(ctx.membershipRepository, COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER);
        await withHttpServer(ctx.app, async (baseUrl) => {
          await httpJson(
            baseUrl,
            'POST',
            ANALYSIS_PATH,
            costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
            { accountId: COST_ACCOUNT_A, regions: ['us-east-1', 'us-west-2'] },
          );
        });
        let blob = audit.events.join('\n');
        assert.match(blob, /ec2\.cost_analysis_partial/);

        await seedRunningInstance(resources, 'i-fail-only', 'us-east-1');
        const failCtx = buildEc2CostHttpApp({
          awsRepo,
          resources,
          costRepo,
          service: makeAnalysisService(awsRepo, resources, costRepo, {
            metricsFactory: () => ({
              collectMetrics: async () => {
                throw Object.assign(new Error('fail-secret'), { name: 'AccessDenied' });
              },
            }),
          }),
        });
        await seedMembership(failCtx.membershipRepository, COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER);
        await withHttpServer(failCtx.app, async (baseUrl) => {
          await httpJson(
            baseUrl,
            'POST',
            ANALYSIS_PATH,
            costIdentity(COST_TENANT_A, 'owner', TENANT_ROLES.TENANT_OWNER),
            { accountId: COST_ACCOUNT_A, regions: ['us-east-1'] },
          );
        });
        blob = audit.events.join('\n');
        assert.match(blob, /ec2\.cost_analysis_failed/);
        assert.doesNotMatch(blob, /fail-secret/);
      } finally {
        audit.restore();
      }
    });
  });
});
