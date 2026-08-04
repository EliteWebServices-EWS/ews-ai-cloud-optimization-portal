import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { EC2_DISCOVERY_MAX_REGIONS_PER_REQUEST } from '../../cloud-intelligence/ec2-discovery-limits';
import { TENANT_ROLES } from '../../auth';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  TENANT_A,
  TENANT_B,
  assertNoSecrets,
  buildEc2HttpApp,
  dataOf,
  emptyInventory,
  httpJson,
  inventoryWithInstance,
  mockClientFactory,
  seedMembership,
  seedVerifiedAccount,
  withHttpServer,
} from './ec2-discovery-http.helpers';

describe('EC2 discovery HTTP', () => {
  before(() => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
  });
  after(() => {
    delete process.env.AUDIT_PERSISTENCE_ENABLED;
  });

  it('POST discovery returns 200 with expected payload shape for verified owner', async () => {
    const ctx = buildEc2HttpApp(mockClientFactory({ 'us-east-1': inventoryWithInstance('i-1') }));
    await seedMembership(ctx.membershipRepository, TENANT_A, 'owner-a', TENANT_ROLES.TENANT_OWNER);
    await seedVerifiedAccount(ctx.awsRepo, TENANT_A, ACCOUNT_A, 'us-east-1');
    await withHttpServer(ctx.app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'owner-a', tenantId: TENANT_A },
        {},
      );
      assert.equal(res.status, 200);
      const data = dataOf(res.body);
      assert.ok(typeof data.runId === 'string');
      assert.equal(data.status, 'SUCCEEDED');
      assert.equal(data.accountId, ACCOUNT_A);
      assert.deepEqual(data.regions, ['us-east-1']);
      assert.ok(data.resourceCounts);
      assert.ok(Array.isArray(data.warnings));
      assertNoSecrets(res.body);
    });
  });

  it('tenant admin and security admin can start discovery', async () => {
    for (const [userId, role] of [
      ['admin-a', TENANT_ROLES.TENANT_ADMIN],
      ['sec-a', TENANT_ROLES.SECURITY_ADMIN],
    ] as const) {
      const ctx = buildEc2HttpApp(mockClientFactory({ 'us-east-1': emptyInventory() }));
      await seedMembership(ctx.membershipRepository, TENANT_A, userId, role);
      await seedVerifiedAccount(ctx.awsRepo, TENANT_A, ACCOUNT_A, 'us-east-1');
      await withHttpServer(ctx.app, async (baseUrl) => {
        const res = await httpJson(
          baseUrl,
          'POST',
          `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
          { userId, tenantId: TENANT_A },
          {},
        );
        assert.equal(res.status, 200, role);
      });
    }
  });

  it('cross-tenant account id returns same 404 as missing account', async () => {
    const ctx = buildEc2HttpApp(mockClientFactory({}));
    await seedMembership(ctx.membershipRepository, TENANT_A, 'owner-a', TENANT_ROLES.TENANT_OWNER);
    await seedVerifiedAccount(ctx.awsRepo, TENANT_B, ACCOUNT_B, 'us-east-1');
    await withHttpServer(ctx.app, async (baseUrl) => {
      const missing = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'owner-a', tenantId: TENANT_A },
        {},
      );
      const cross = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_B}/ec2/discovery`,
        { userId: 'owner-a', tenantId: TENANT_A },
        {},
      );
      assert.equal(missing.status, 404);
      assert.equal(cross.status, 404);
    });
  });

  it('rejects malformed request body safely', async () => {
    const ctx = buildEc2HttpApp(mockClientFactory({}));
    await seedMembership(ctx.membershipRepository, TENANT_A, 'owner-a', TENANT_ROLES.TENANT_OWNER);
    await seedVerifiedAccount(ctx.awsRepo, TENANT_A, ACCOUNT_A, 'us-east-1');
    await withHttpServer(ctx.app, async (baseUrl) => {
      const notObject = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'owner-a', tenantId: TENANT_A },
        ['bad'],
      );
      assert.equal(notObject.status, 422);
      const badRegions = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'owner-a', tenantId: TENANT_A },
        { regions: 'us-east-1' },
      );
      assert.equal(badRegions.status, 422);
    });
  });

  it('returns 403 when caller has no tenant membership', async () => {
    const ctx = buildEc2HttpApp(mockClientFactory({ 'us-east-1': emptyInventory() }));
    await seedVerifiedAccount(ctx.awsRepo, TENANT_A, ACCOUNT_A, 'us-east-1');
    await withHttpServer(ctx.app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'stranger', tenantId: TENANT_A },
        {},
      );
      assert.equal(res.status, 403);
    });
  });

  it('rejects excess regions with 422', async () => {
    const ctx = buildEc2HttpApp(mockClientFactory({}));
    await seedMembership(ctx.membershipRepository, TENANT_A, 'owner-a', TENANT_ROLES.TENANT_OWNER);
    await seedVerifiedAccount(ctx.awsRepo, TENANT_A, ACCOUNT_A, 'us-east-1');
    const regions = Array.from(
      { length: EC2_DISCOVERY_MAX_REGIONS_PER_REQUEST + 1 },
      (_, i) => `us-east-${i + 1}`,
    );
    await withHttpServer(ctx.app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'owner-a', tenantId: TENANT_A },
        { regions },
      );
      assert.equal(res.status, 422);
    });
  });

  it('defaults region, deduplicates, and rejects malformed region', async () => {
    const ctx = buildEc2HttpApp(mockClientFactory({ 'eu-west-1': emptyInventory() }));
    await seedMembership(ctx.membershipRepository, TENANT_A, 'owner-a', TENANT_ROLES.TENANT_OWNER);
    await seedVerifiedAccount(ctx.awsRepo, TENANT_A, ACCOUNT_A, 'eu-west-1');
    await withHttpServer(ctx.app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'owner-a', tenantId: TENANT_A },
      );
      assert.deepEqual(dataOf(res.body).regions, ['eu-west-1']);

      const dedup = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'owner-a', tenantId: TENANT_A },
        { regions: ['eu-west-1', 'eu-west-1'] },
      );
      assert.deepEqual(dataOf(dedup.body).regions, ['eu-west-1']);

      const bad = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'owner-a', tenantId: TENANT_A },
        { regions: ['bad'] },
      );
      assert.equal(bad.status, 422);
    });
  });

  it('returns 409 for unverified and 404 for missing account', async () => {
    const ctx = buildEc2HttpApp(mockClientFactory({}));
    await seedMembership(ctx.membershipRepository, TENANT_A, 'owner-a', TENANT_ROLES.TENANT_OWNER);
    await withHttpServer(ctx.app, async (baseUrl) => {
      const missing = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'owner-a', tenantId: TENANT_A },
        {},
      );
      assert.equal(missing.status, 404);
    });
    await ctx.awsRepo.create({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      roleArn: `arn:aws:iam::${ACCOUNT_A}:role/R`,
      externalId: 'ext',
      region: 'us-east-1',
      status: 'PENDING',
      verificationStatus: 'NOT_STARTED',
      metadata: {},
    });
    await withHttpServer(ctx.app, async (baseUrl) => {
      const unverified = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'owner-a', tenantId: TENANT_A },
        {},
      );
      assert.equal(unverified.status, 409);
    });
  });

  it('returns 403 for viewer and 401 when unauthenticated', async () => {
    const ctx = buildEc2HttpApp(mockClientFactory({ 'us-east-1': emptyInventory() }));
    await seedVerifiedAccount(ctx.awsRepo, TENANT_A, ACCOUNT_A, 'us-east-1');
    await seedMembership(ctx.membershipRepository, TENANT_A, 'v', TENANT_ROLES.VIEWER);
    await seedMembership(ctx.membershipRepository, TENANT_A, 'o', TENANT_ROLES.TENANT_OWNER);
    await withHttpServer(ctx.app, async (baseUrl) => {
      const forbidden = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'v', tenantId: TENANT_A, groups: ['viewer'] },
        {},
      );
      assert.equal(forbidden.status, 403);
      const unauth = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'o', tenantId: TENANT_A, authenticated: false },
        {},
      );
      assert.equal(unauth.status, 401);
    });
  });

  it('returns PARTIAL without raw AWS error text and persists successful region', async () => {
    const err = new Error('User is not authorized to perform ec2:DescribeInstances');
    err.name = 'AccessDenied';
    const ctx = buildEc2HttpApp(
      mockClientFactory({ 'us-east-1': inventoryWithInstance('i-p') }, { 'us-west-2': err }),
    );
    await seedMembership(ctx.membershipRepository, TENANT_A, 'owner-a', TENANT_ROLES.TENANT_OWNER);
    await seedVerifiedAccount(ctx.awsRepo, TENANT_A, ACCOUNT_A, 'us-east-1');
    await withHttpServer(ctx.app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'owner-a', tenantId: TENANT_A },
        { regions: ['us-east-1', 'us-west-2'] },
      );
      assert.equal(res.status, 200);
      const data = dataOf(res.body);
      assert.equal(data.status, 'PARTIAL');
      assert.doesNotMatch(JSON.stringify(res.body), /not authorized to perform ec2:DescribeInstances/);
      const saved = await ctx.ec2Repo.getResource({
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        region: 'us-east-1',
        resourceType: 'INSTANCE',
        resourceId: 'i-p',
      });
      assert.equal(saved?.status, 'ACTIVE');
    });
  });

  it('maps throttling to sanitized warning codes without raw SDK payload', async () => {
    const err = new Error('Rate exceeded');
    err.name = 'ThrottlingException';
    const ctx = buildEc2HttpApp(mockClientFactory({}, { 'us-east-1': err }));
    await seedMembership(ctx.membershipRepository, TENANT_A, 'owner-a', TENANT_ROLES.TENANT_OWNER);
    await seedVerifiedAccount(ctx.awsRepo, TENANT_A, ACCOUNT_A, 'us-east-1');
    await withHttpServer(ctx.app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'owner-a', tenantId: TENANT_A },
        {},
      );
      assert.equal(res.status, 200);
      assert.equal(dataOf(res.body).status, 'FAILED');
      const warnings = dataOf(res.body).warnings as string[];
      assert.ok(warnings.some((w) => w.includes('ThrottlingException')));
      assert.doesNotMatch(JSON.stringify(res.body), /Rate exceeded/);
    });
  });
});

describe('EC2 resources HTTP', () => {
  before(() => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
  });
  after(() => {
    delete process.env.AUDIT_PERSISTENCE_ENABLED;
  });

  async function seedViewer(ctx: ReturnType<typeof buildEc2HttpApp>) {
    await seedMembership(ctx.membershipRepository, TENANT_A, 'viewer-a', TENANT_ROLES.VIEWER);
    await seedVerifiedAccount(ctx.awsRepo, TENANT_A, ACCOUNT_A, 'us-east-1');
  }

  it('requires accountId on list and summary', async () => {
    const ctx = buildEc2HttpApp();
    await seedViewer(ctx);
    await withHttpServer(ctx.app, async (baseUrl) => {
      const list = await httpJson(baseUrl, 'GET', '/api/v1/ec2/resources', {
        userId: 'viewer-a',
        tenantId: TENANT_A,
        groups: ['viewer'],
      });
      assert.equal(list.status, 422);
      const summary = await httpJson(baseUrl, 'GET', '/api/v1/ec2/resources/summary', {
        userId: 'viewer-a',
        tenantId: TENANT_A,
        groups: ['viewer'],
      });
      assert.equal(summary.status, 422);
    });
  });

  it('lists tenant-scoped resources with filters and pagination', async () => {
    const ctx = buildEc2HttpApp();
    await seedViewer(ctx);
    await ctx.ec2Repo.upsertDiscoveredResource({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-a',
      tags: [],
      status: 'ACTIVE',
      metadata: { state: 'running', instanceType: 't3.micro' },
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });
    await ctx.ec2Repo.upsertDiscoveredResource({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'us-west-2',
      resourceType: 'VOLUME',
      resourceId: 'vol-b',
      tags: [],
      status: 'NOT_SEEN',
      metadata: {},
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });
    await ctx.ec2Repo.upsertDiscoveredResource({
      tenantId: TENANT_B,
      accountId: ACCOUNT_B,
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-other-tenant',
      tags: [],
      status: 'ACTIVE',
      metadata: {},
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });
    await withHttpServer(ctx.app, async (baseUrl) => {
      const page1 = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources?accountId=${ACCOUNT_A}&limit=1`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      assert.equal(page1.status, 200);
      const items1 = (dataOf(page1.body).items as unknown[]) ?? [];
      assert.equal(items1.length, 1);
      const token = dataOf(page1.body).nextToken as string;
      assert.ok(token);
      const page2 = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources?accountId=${ACCOUNT_A}&limit=1&nextToken=${token}`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      assert.equal((dataOf(page2.body).items as unknown[]).length, 1);

      const regionFilter = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources?accountId=${ACCOUNT_A}&region=us-west-2`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      const regionItems = dataOf(regionFilter.body).items as Array<{ resourceId: string }>;
      assert.equal(regionItems.length, 1);
      assert.equal(regionItems[0].resourceId, 'vol-b');

      const statusFilter = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources?accountId=${ACCOUNT_A}&status=NOT_SEEN`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      assert.equal((dataOf(statusFilter.body).items as unknown[]).length, 1);

      const typeFilter = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources?accountId=${ACCOUNT_A}&resourceType=INSTANCE`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      const typeItems = dataOf(typeFilter.body).items as Array<{ resourceId: string }>;
      assert.equal(typeItems.length, 1);
      assert.equal(typeItems[0].resourceId, 'i-a');
      assert.doesNotMatch(JSON.stringify(page1.body), /i-other-tenant/);
    });
  });

  it('get resource requires region and returns 404 for missing or cross-tenant', async () => {
    const ctx = buildEc2HttpApp();
    await seedViewer(ctx);
    await ctx.ec2Repo.upsertDiscoveredResource({
      tenantId: TENANT_B,
      accountId: ACCOUNT_B,
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-hidden',
      tags: [],
      status: 'ACTIVE',
      metadata: {},
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });
    await withHttpServer(ctx.app, async (baseUrl) => {
      const noRegion = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources/INSTANCE/i-a?accountId=${ACCOUNT_A}`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      assert.equal(noRegion.status, 422);

      const missing = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources/INSTANCE/i-missing?accountId=${ACCOUNT_A}&region=us-east-1`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      assert.equal(missing.status, 404);

      const cross = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources/INSTANCE/i-hidden?accountId=${ACCOUNT_B}&region=us-east-1`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      assert.equal(cross.status, 404);
    });
  });

  it('summary route is not captured by dynamic resource route and returns zero summary', async () => {
    const ctx = buildEc2HttpApp();
    await seedViewer(ctx);
    await withHttpServer(ctx.app, async (baseUrl) => {
      const summary = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources/summary?accountId=${ACCOUNT_A}`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      assert.equal(summary.status, 200);
      const data = dataOf(summary.body);
      assert.equal(data.totalResources, 0);
      assert.equal(data.staleResourceCount, 0);
      assert.deepEqual(data.resourcesByType, {});
    });
  });

  it('summary aggregates counts for caller tenant only', async () => {
    const ctx = buildEc2HttpApp();
    await seedViewer(ctx);
    await ctx.ec2Repo.upsertDiscoveredResource({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-sum',
      tags: [],
      status: 'ACTIVE',
      metadata: { state: 'running', instanceType: 't3.small' },
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });
    await ctx.ec2Repo.upsertDiscoveredResource({
      tenantId: TENANT_B,
      accountId: ACCOUNT_B,
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-other',
      tags: [],
      status: 'ACTIVE',
      metadata: {},
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });
    await withHttpServer(ctx.app, async (baseUrl) => {
      const summary = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources/summary?accountId=${ACCOUNT_A}`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      const data = dataOf(summary.body);
      assert.equal(data.totalResources, 1);
      assert.equal((data.resourcesByType as Record<string, number>).INSTANCE, 1);
      assert.equal((data.instancesByState as Record<string, number>).running, 1);
      assert.equal((data.instancesByRegion as Record<string, number>)['us-east-1'], 1);
      assert.equal((data.instancesByInstanceType as Record<string, number>)['t3.small'], 1);
    });
  });
});
