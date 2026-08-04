import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DescribeInstancesCommand } from '@aws-sdk/client-ec2';

import { createAwsEc2DiscoveryClient } from '../../cloud-intelligence/plugins/ec2/aws-ec2-discovery-client';
import { normalizeEc2RegionalInventory } from '../../cloud-intelligence/plugins/ec2/ec2-discovery-normalizer';
import { TENANT_ROLES } from '../../auth';
import {
  ACCOUNT_A,
  TENANT_A,
  assertNoSecrets,
  buildEc2HttpApp,
  dataOf,
  httpJson,
  inventoryWithInstance,
  mockClientFactory,
  seedMembership,
  seedVerifiedAccount,
  withHttpServer,
} from '../integration/ec2-discovery-http.helpers';

const FORBIDDEN_NORMALIZATION_KEYS =
  /userData|UserData|passwordData|accessKeyId|secretAccessKey|sessionToken/i;

const FORBIDDEN_SDK_LEAK_KEYS = /\$metadata|totalRetryDelay|"attempts"/;

describe('EC2 discovery data leakage regressions', () => {
  it('normalization output never contains credential or userData fields', async () => {
    const ec2 = {
      send: async (command: unknown) => {
        if (command instanceof DescribeInstancesCommand) {
          return {
            Reservations: [
              {
                Instances: [
                  {
                    InstanceId: 'i-leak-check',
                    UserData: 'c2VjcmV0',
                    Tags: [{ Key: 'Name', Value: 'n' }],
                  },
                ],
              },
            ],
          };
        }
        return {};
      },
    };
    const inventory = await createAwsEc2DiscoveryClient(ec2 as never).discoverRegionalInventory(
      'us-east-1',
    );
    const serialized = JSON.stringify(inventory);
    assert.doesNotMatch(serialized, FORBIDDEN_NORMALIZATION_KEYS);
    const normalized = normalizeEc2RegionalInventory(inventory, 'us-east-1');
    assert.doesNotMatch(JSON.stringify(normalized), FORBIDDEN_NORMALIZATION_KEYS);
  });

  it('HTTP discovery and resource responses omit SDK metadata and credentials', async () => {
    process.env.AUDIT_PERSISTENCE_ENABLED = 'false';
    const ctx = buildEc2HttpApp(mockClientFactory({ 'us-east-1': inventoryWithInstance('i-http') }));
    await seedMembership(ctx.membershipRepository, TENANT_A, 'owner-a', TENANT_ROLES.TENANT_OWNER);
    await seedMembership(ctx.membershipRepository, TENANT_A, 'viewer-a', TENANT_ROLES.VIEWER);
    await seedVerifiedAccount(ctx.awsRepo, TENANT_A, ACCOUNT_A, 'us-east-1');
    await withHttpServer(ctx.app, async (baseUrl) => {
      const discovery = await httpJson(
        baseUrl,
        'POST',
        `/api/v1/aws-accounts/${ACCOUNT_A}/ec2/discovery`,
        { userId: 'owner-a', tenantId: TENANT_A },
        {},
      );
      const discoveryJson = JSON.stringify(discovery.body);
      assert.doesNotMatch(discoveryJson, FORBIDDEN_SDK_LEAK_KEYS);
      assertNoSecrets(discovery.body);

      const list = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources?accountId=${ACCOUNT_A}`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      assert.doesNotMatch(JSON.stringify(list.body), FORBIDDEN_SDK_LEAK_KEYS);

      const item = (dataOf(list.body).items as Array<{ resourceId: string }>)[0];
      assert.ok(item);
      const get = await httpJson(
        baseUrl,
        'GET',
        `/api/v1/ec2/resources/INSTANCE/${item.resourceId}?accountId=${ACCOUNT_A}&region=us-east-1`,
        { userId: 'viewer-a', tenantId: TENANT_A, groups: ['viewer'] },
      );
      assert.doesNotMatch(JSON.stringify(get.body), FORBIDDEN_SDK_LEAK_KEYS);
    });
  });
});
