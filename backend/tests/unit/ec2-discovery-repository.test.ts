import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Ec2DiscoveryOrchestrator } from '../../cloud-intelligence/orchestration/ec2-discovery-orchestrator';
import { createCloudDiscoveryPluginRegistry } from '../../cloud-intelligence/registry/cloud-discovery-plugin-registry';
import type { CloudResourceDiscoveryPlugin } from '../../cloud-intelligence/plugins/cloud-resource-discovery-plugin';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { RepositoryConflictError } from '../../database';

describe('EC2 discovery repository and stale rules', () => {
  it('creates version 1 then increments without duplicate rows', async () => {
    const repo = new MockEc2CloudResourceRepository();
    const first = await repo.upsertDiscoveredResource({
      tenantId: 't1',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-1',
      tags: [],
      status: 'ACTIVE',
      metadata: { state: 'running' },
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(first.version, 1);
    assert.equal(first.firstSeenAt, first.discoveredAt);
    const second = await repo.upsertDiscoveredResource({
      tenantId: 't1',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-1',
      tags: [],
      status: 'ACTIVE',
      metadata: { state: 'stopped' },
      discoveredAt: '2026-01-02T00:00:00.000Z',
    });
    assert.equal(second.version, 2);
    assert.equal(second.firstSeenAt, first.firstSeenAt);
    assert.equal(second.lastSeenAt, '2026-01-02T00:00:00.000Z');
    const page = await repo.listResources({
      tenantId: 't1',
      accountId: '111122223333',
    });
    assert.equal(page.items.length, 1);
  });

  it('marks NOT_SEEN only for successful scope and leaves failed region ACTIVE', async () => {
    const repo = new MockEc2CloudResourceRepository();
    await repo.upsertDiscoveredResource({
      tenantId: 't1',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-east',
      tags: [],
      status: 'ACTIVE',
      metadata: {},
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });
    await repo.upsertDiscoveredResource({
      tenantId: 't1',
      accountId: '111122223333',
      region: 'us-west-2',
      resourceType: 'INSTANCE',
      resourceId: 'i-west',
      tags: [],
      status: 'ACTIVE',
      metadata: {},
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });
    await repo.upsertDiscoveredResource({
      tenantId: 't1',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'VOLUME',
      resourceId: 'vol-1',
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
          warnings: ['us-west-2:AccessDenied'],
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
      tenantId: 't1',
      accountId: '111122223333',
      regions: ['us-east-1', 'us-west-2'],
      runId: 'run-stale',
      startedAt: '2026-01-02T00:00:00.000Z',
    });

    const east = await repo.getResource({
      tenantId: 't1',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-east',
    });
    const west = await repo.getResource({
      tenantId: 't1',
      accountId: '111122223333',
      region: 'us-west-2',
      resourceType: 'INSTANCE',
      resourceId: 'i-west',
    });
    const volume = await repo.getResource({
      tenantId: 't1',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'VOLUME',
      resourceId: 'vol-1',
    });
    assert.equal(east?.status, 'NOT_SEEN');
    assert.equal(west?.status, 'ACTIVE');
    assert.equal(volume?.status, 'ACTIVE');
  });

  it('throws conflict on markNotSeen version mismatch', async () => {
    const repo = new MockEc2CloudResourceRepository();
    const row = await repo.upsertDiscoveredResource({
      tenantId: 't1',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-1',
      tags: [],
      status: 'ACTIVE',
      metadata: {},
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });
    await assert.rejects(
      () =>
        repo.markNotSeen({
          tenantId: 't1',
          accountId: '111122223333',
          region: 'us-east-1',
          resourceType: 'INSTANCE',
          resourceId: 'i-1',
          expectedVersion: row.version + 99,
        }),
      RepositoryConflictError,
    );
  });

  it('throws conflict on completeRun version mismatch', async () => {
    const repo = new MockEc2CloudResourceRepository();
    const run = await repo.createRun({
      runId: 'run-x',
      tenantId: 't1',
      accountId: '111122223333',
      requestedRegions: ['us-east-1'],
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    await assert.rejects(
      () =>
        repo.completeRun({
          tenantId: 't1',
          accountId: '111122223333',
          runId: 'run-x',
          expectedVersion: run.version + 5,
          status: 'SUCCEEDED',
          completedAt: '2026-01-02T00:00:00.000Z',
          resourceCounts: {},
          regionsSucceeded: ['us-east-1'],
          regionsFailed: [],
          warnings: [],
        }),
      RepositoryConflictError,
    );
  });

  it('DynamoDB repository uses Query and not Scan', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'repositories/dynamodb/dynamodb-ec2-cloud-resource-repository.ts'),
      'utf8',
    );
    assert.match(source, /QueryCommand/);
    assert.doesNotMatch(source, /ScanCommand/);
  });
});
