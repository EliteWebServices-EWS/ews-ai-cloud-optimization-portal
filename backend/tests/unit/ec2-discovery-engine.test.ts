import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeEc2RegionalInventory } from '../../cloud-intelligence/plugins/ec2/ec2-discovery-normalizer';
import type { Ec2RegionalInventoryDto } from '../../cloud-intelligence/plugins/ec2/ec2-discovery-client.port';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { Ec2DiscoveryOrchestrator } from '../../cloud-intelligence/orchestration/ec2-discovery-orchestrator';
import { createCloudDiscoveryPluginRegistry } from '../../cloud-intelligence/registry/cloud-discovery-plugin-registry';
import type { CloudResourceDiscoveryPlugin } from '../../cloud-intelligence/plugins/cloud-resource-discovery-plugin';
import { createEc2Routes } from '../../api/routes/ec2.routes';
import { Ec2DiscoveryApiService } from '../../services/ec2-discovery-api-service';
import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';
import { resolveEc2DiscoveryRegions } from '../../services/ec2-discovery-api-service';
import { sanitizeCloudResourceTags } from '../../cloud-intelligence/sanitize';
import { EC2_DISCOVERY_MAX_REGIONS_PER_REQUEST } from '../../cloud-intelligence/ec2-discovery-limits';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('EC2 discovery engine', () => {
  it('normalizes instances with Name tag and optional fields', () => {
    const inventory: Ec2RegionalInventoryDto = {
      instances: [
        {
          instanceId: 'i-abc',
          instanceType: 't3.micro',
          state: 'running',
          tags: [{ key: 'Name', value: 'web-1' }],
          securityGroupIds: [],
          securityGroupNames: [],
        },
      ],
      images: [],
      volumes: [],
      elasticIps: [],
      networkInterfaces: [],
      placementGroups: [],
      launchTemplates: [],
    };
    const resources = normalizeEc2RegionalInventory(inventory, 'us-east-1');
    assert.equal(resources.length, 1);
    assert.equal(resources[0].name, 'web-1');
    assert.equal(resources[0].resourceType, 'INSTANCE');
  });

  it('preserves firstSeenAt and updates lastSeenAt on upsert', async () => {
    const repo = new MockEc2CloudResourceRepository();
    const ts1 = '2026-01-01T00:00:00.000Z';
    const ts2 = '2026-01-02T00:00:00.000Z';
    await repo.upsertDiscoveredResource({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-1',
      tags: [],
      status: 'ACTIVE',
      metadata: { state: 'running' },
      discoveredAt: ts1,
    });
    const second = await repo.upsertDiscoveredResource({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-1',
      tags: [],
      status: 'ACTIVE',
      metadata: { state: 'stopped' },
      discoveredAt: ts2,
    });
    assert.equal(second.firstSeenAt, ts1);
    assert.equal(second.lastSeenAt, ts2);
    assert.equal(second.version, 2);
  });

  it('marks missing resources NOT_SEEN only for successful scope', async () => {
    const repo = new MockEc2CloudResourceRepository();
    await repo.upsertDiscoveredResource({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-stale',
      tags: [],
      status: 'ACTIVE',
      metadata: {},
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });

    const plugin: CloudResourceDiscoveryPlugin = {
      service: 'ec2',
      async discover() {
        return {
          resources: [],
          warnings: [],
          completedScopes: [{ region: 'us-east-1', resourceType: 'INSTANCE', succeeded: true }],
        };
      },
    };
    const orchestrator = new Ec2DiscoveryOrchestrator(
      createCloudDiscoveryPluginRegistry([plugin]),
      repo,
      repo,
    );
    await orchestrator.runDiscovery({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      regions: ['us-east-1'],
      runId: 'run-1',
      startedAt: '2026-01-02T00:00:00.000Z',
    });
    const stale = await repo.getResource({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-stale',
    });
    assert.equal(stale?.status, 'NOT_SEEN');
  });

  it('does not mark stale when regional discovery scope did not succeed', async () => {
    const repo = new MockEc2CloudResourceRepository();
    await repo.upsertDiscoveredResource({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-keep',
      tags: [],
      status: 'ACTIVE',
      metadata: {},
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });
    const plugin: CloudResourceDiscoveryPlugin = {
      service: 'ec2',
      async discover() {
        return { resources: [], warnings: ['us-east-1:AccessDenied'], completedScopes: [] };
      },
    };
    const orchestrator = new Ec2DiscoveryOrchestrator(
      createCloudDiscoveryPluginRegistry([plugin]),
      repo,
      repo,
    );
    await orchestrator.runDiscovery({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      regions: ['us-east-1'],
      runId: 'run-2',
      startedAt: '2026-01-02T00:00:00.000Z',
    });
    const kept = await repo.getResource({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-keep',
    });
    assert.equal(kept?.status, 'ACTIVE');
  });

  it('defaults discovery regions to registered account region', () => {
    const regions = resolveEc2DiscoveryRegions(undefined, 'eu-west-1');
    assert.deepEqual(regions, ['eu-west-1']);
  });

  it('rejects too many regions', () => {
    const many = Array.from({ length: EC2_DISCOVERY_MAX_REGIONS_PER_REQUEST + 1 }, (_, i) =>
      `us-east-${i + 1}`,
    );
    assert.throws(
      () => resolveEc2DiscoveryRegions({ regions: many }, 'us-east-1'),
      /At most/,
    );
  });

  it('registers summary route before dynamic resource route', () => {
    const repo = new MockEc2CloudResourceRepository();
    const service = new Ec2DiscoveryApiService(new MockAwsAccountRepository(), repo, repo);
    const router = createEc2Routes({
      ec2DiscoveryApi: service,
      membershipRepository: { findByTenantAndUser: async () => null } as never,
    });
    const stack = (router as unknown as { stack: Array<{ route?: { path?: string } }> }).stack;
    const paths = stack
      .map((layer) => layer.route?.path)
      .filter((value): value is string => Boolean(value));
    const summaryIndex = paths.indexOf('/ec2/resources/summary');
    const dynamicIndex = paths.indexOf('/ec2/resources/:resourceType/:resourceId');
    assert.ok(summaryIndex >= 0 && dynamicIndex >= 0);
    assert.ok(summaryIndex < dynamicIndex);
  });

  it('sanitizes secret-like tags', () => {
    const tags = sanitizeCloudResourceTags([
      { key: 'Name', value: 'app' },
      { key: 'SecretToken', value: 'abc' },
    ]);
    assert.equal(tags.length, 1);
    assert.equal(tags[0].key, 'Name');
  });

  it('SAM template defines cloud resources table without platform ec2 permissions', () => {
    const template = readFileSync(
      path.resolve(process.cwd(), 'template.yaml'),
      'utf8',
    );
    assert.match(template, /SisumCloudResourcesTable/);
    assert.match(template, /CLOUD_RESOURCES_TABLE_NAME/);
    assert.doesNotMatch(template, /ec2:DescribeInstances[\s\S]*SisumLambdaExecutionRole/);
  });
});

describe('EC2 discovery normalization types', () => {
  it('normalizes AMI, volume, eip, eni, placement group, and launch template', () => {
    const inventory: Ec2RegionalInventoryDto = {
      instances: [],
      images: [{ imageId: 'ami-1', tags: [] }],
      volumes: [{ volumeId: 'vol-1', tags: [] }],
      elasticIps: [{ allocationId: 'eipalloc-1', tags: [] }],
      networkInterfaces: [{ networkInterfaceId: 'eni-1', tags: [] }],
      placementGroups: [{ groupName: 'pg-1', tags: [] }],
      launchTemplates: [{ launchTemplateId: 'lt-1', tags: [] }],
    };
    const resources = normalizeEc2RegionalInventory(inventory, 'us-west-2');
    const types = resources.map((r) => r.resourceType).sort();
    assert.deepEqual(types, [
      'ELASTIC_IP',
      'IMAGE',
      'LAUNCH_TEMPLATE',
      'NETWORK_INTERFACE',
      'PLACEMENT_GROUP',
      'VOLUME',
    ]);
  });
});
