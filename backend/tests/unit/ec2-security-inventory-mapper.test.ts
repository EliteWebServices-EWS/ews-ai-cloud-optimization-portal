import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeComplianceScore,
  mapDiscoveredInstanceToSecurityInventory,
} from '../../cloud-intelligence/ec2-security/ec2-security-inventory-mapper';

describe('ec2-security-inventory-mapper', () => {
  it('maps discovered instance metadata into analyzer inventory shape', () => {
    const item = mapDiscoveredInstanceToSecurityInventory(
      {
        tenantId: 'tenant-a',
        accountId: '111122223333',
        region: 'us-east-1',
        service: 'ec2',
        resourceType: 'INSTANCE',
        resourceId: 'i-test',
        tags: [{ key: 'Name', value: 'app-node' }],
        status: 'ACTIVE',
        metadata: {
          instanceType: 't3.small',
          state: 'running',
          publicIpAddress: '203.0.113.1',
          monitoringState: 'enabled',
        },
        version: 1,
        discoveredAt: '2026-01-01T00:00:00.000Z',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      [
        {
          tenantId: 'tenant-a',
          accountId: '111122223333',
          region: 'us-east-1',
          service: 'ec2',
          resourceType: 'VOLUME',
          resourceId: 'vol-test',
          tags: [],
          status: 'ACTIVE',
          metadata: { encrypted: true },
          version: 1,
          discoveredAt: '2026-01-01T00:00:00.000Z',
          firstSeenAt: '2026-01-01T00:00:00.000Z',
          lastSeenAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    );

    assert.equal(item.instanceId, 'i-test');
    assert.equal(item.instanceType, 't3.small');
    assert.equal(item.cloudWatchMonitoring, true);
    assert.equal(item.ebsVolumes?.[0]?.encrypted, true);
  });

  it('computes compliance score as average of security and governance scores', () => {
    assert.equal(computeComplianceScore(80, 60), 70);
  });
});
