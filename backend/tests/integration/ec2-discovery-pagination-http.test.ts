import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

import { encodeNextToken } from '../../database';
import { DynamoDbEc2CloudResourceRepository } from '../../repositories/dynamodb/dynamodb-ec2-cloud-resource-repository';
import {
  encodeEc2ResourceListNextTokenForTest,
} from '../../repositories/ec2-cloud-resource-pagination';
import { TENANT_ROLES } from '../../auth';
import {
  ACCOUNT_A,
  TENANT_A,
  buildEc2HttpApp,
  httpJson,
  seedMembership,
  seedVerifiedAccount,
  withHttpServer,
} from './ec2-discovery-http.helpers';

describe('EC2 resources list pagination HTTP', () => {
  before(() => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
  });
  after(() => {
    delete process.env.AUDIT_PERSISTENCE_ENABLED;
  });

  async function seedTwo(ctx: ReturnType<typeof buildEc2HttpApp>) {
    await seedMembership(ctx.membershipRepository, TENANT_A, 'viewer-a', TENANT_ROLES.VIEWER);
    await seedVerifiedAccount(ctx.awsRepo, TENANT_A, ACCOUNT_A, 'us-east-1');
    for (const id of ['i-aaa', 'i-bbb']) {
      await ctx.ec2Repo.upsertDiscoveredResource({
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        region: 'us-east-1',
        resourceType: 'INSTANCE',
        resourceId: id,
        tags: [],
        status: 'ACTIVE',
        metadata: {},
        discoveredAt: '2026-01-01T00:00:00.000Z',
      });
    }
  }

  it('returns 422 for malformed production-style pagination token', async () => {
    const ctx = buildEc2HttpApp();
    await seedTwo(ctx);
    await withHttpServer(ctx.app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources?accountId=${ACCOUNT_A}&limit=1&nextToken=not-valid-base64`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      assert.equal(res.status, 422);
      assert.equal((res.body as { error: { code: string } }).error.code, 'INVALID_REQUEST');
      assert.doesNotMatch(JSON.stringify(res.body), /SyntaxError/);
    });
  });

  it('continues pages with scoped nextToken without duplicates', async () => {
    const ctx = buildEc2HttpApp();
    await seedTwo(ctx);
    await withHttpServer(ctx.app, async (baseUrl) => {
      const page1 = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources?accountId=${ACCOUNT_A}&limit=1`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      const ids1 = ((page1.body as { data: { items: Array<{ resourceId: string }> } }).data.items).map(
        (i) => i.resourceId,
      );
      const token = (page1.body as { data: { nextToken?: string } }).data.nextToken;
      assert.ok(token);
      const page2 = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources?accountId=${ACCOUNT_A}&limit=1&nextToken=${encodeURIComponent(token!)}`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      const ids2 = ((page2.body as { data: { items: Array<{ resourceId: string }> } }).data.items).map(
        (i) => i.resourceId,
      );
      assert.equal(new Set([...ids1, ...ids2]).size, 2);
    });
  });

  it('rejects unscoped raw DynamoDB token at HTTP layer', async () => {
    const ctx = buildEc2HttpApp();
    await seedTwo(ctx);
    const raw = encodeNextToken({
      pk: `TENANT#${TENANT_A}#AWS_ACCOUNT#${ACCOUNT_A}`,
      sk: 'CLOUD_RESOURCE#us-east-1#SERVICE#ec2#TYPE#INSTANCE#ID#i-aaa',
    });
    await withHttpServer(ctx.app, async (baseUrl) => {
      const res = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources?accountId=${ACCOUNT_A}&nextToken=${encodeURIComponent(raw!)}`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      assert.equal(res.status, 422);
    });
  });
});

describe('DynamoDbEc2CloudResourceRepository list pagination', () => {
  it('issues Query with decoded scoped ExclusiveStartKey', async () => {
    const query: Parameters<DynamoDbEc2CloudResourceRepository['listResources']>[0] = {
      tenantId: 'tenant-a',
      accountId: '111122223333',
      limit: 1,
    };
    const startKey = {
      pk: 'TENANT#tenant-a#AWS_ACCOUNT#111122223333',
      sk: 'CLOUD_RESOURCE#us-east-1#SERVICE#ec2#TYPE#INSTANCE#ID#i-1',
    };
    const token = encodeEc2ResourceListNextTokenForTest(query, startKey);
    let capturedStart: unknown;
    const client = {
      send: async (command: unknown) => {
        if (command instanceof QueryCommand) {
          capturedStart = command.input.ExclusiveStartKey;
          return {
            Items: [
              {
                pk: startKey.pk,
                sk: 'CLOUD_RESOURCE#us-east-1#SERVICE#ec2#TYPE#INSTANCE#ID#i-2',
                entityType: 'CLOUD_RESOURCE',
                tenantId: 'tenant-a',
                accountId: '111122223333',
                region: 'us-east-1',
                service: 'ec2',
                resourceType: 'INSTANCE',
                resourceId: 'i-2',
                tags: [],
                status: 'ACTIVE',
                version: 1,
                metadata: {},
                discoveredAt: '2026-01-01T00:00:00.000Z',
                firstSeenAt: '2026-01-01T00:00:00.000Z',
                lastSeenAt: '2026-01-01T00:00:00.000Z',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          };
        }
        return {};
      },
    };
    const repo = new DynamoDbEc2CloudResourceRepository(client as never, 'table');
    await repo.listResources({ ...query, nextToken: token });
    assert.deepEqual(capturedStart, startKey);
  });
});
