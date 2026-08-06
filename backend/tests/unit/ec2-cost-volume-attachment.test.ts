import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeEc2RegionalInventory } from '../../cloud-intelligence/plugins/ec2/ec2-discovery-normalizer';
import {
  isVolumeAttachedToInstance,
  readPersistedVolumeAttachments,
  volumesAttachedToInstance,
} from '../../cloud-intelligence/ec2-cost/ec2-volume-attachment';
import { stoppedWithStorageRule } from '../../cloud-intelligence/ec2-cost/ec2-cost-rules';
import type { DiscoveredCloudResourceRecord } from '../../repositories/models/cloud-resource-persistence-models';

describe('Engineer 1 volume attachment metadata', () => {
  it('normalizer persists attachments array from discovery DTO', () => {
    const resources = normalizeEc2RegionalInventory(
      {
        instances: [],
        images: [],
        volumes: [
          {
            volumeId: 'vol-abc',
            sizeGiB: 100,
            volumeType: 'gp3',
            state: 'in-use',
            attachments: [
              {
                instanceId: 'i-stopped',
                deviceName: '/dev/sdf',
                state: 'attached',
                attachTime: '2026-01-01T00:00:00.000Z',
                deleteOnTermination: false,
              },
            ],
            tags: [],
          },
        ],
        elasticIps: [],
        networkInterfaces: [],
        placementGroups: [],
        launchTemplates: [],
      },
      'us-east-1',
    );
    const vol = resources.find((r) => r.resourceId === 'vol-abc');
    assert.ok(vol);
    const attachments = readPersistedVolumeAttachments(vol!.metadata);
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0]?.instanceId, 'i-stopped');
    assert.deepEqual(vol!.metadata.attachedInstanceIds, ['i-stopped']);
  });

  it('detached attachment state does not link volume', () => {
    const volume: DiscoveredCloudResourceRecord = {
      tenantId: 't',
      accountId: 'a',
      region: 'us-east-1',
      service: 'ec2',
      resourceType: 'VOLUME',
      resourceId: 'vol-x',
      tags: [],
      status: 'ACTIVE',
      metadata: {
        attachments: [{ instanceId: 'i-1', state: 'detached' }],
      },
      discoveredAt: '2026-01-01T00:00:00.000Z',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    assert.equal(isVolumeAttachedToInstance(volume, 'i-1'), false);
  });

  it('multiple attachments resolve correct instance', () => {
    const volumes: DiscoveredCloudResourceRecord[] = [
      {
        tenantId: 't',
        accountId: 'a',
        region: 'us-east-1',
        service: 'ec2',
        resourceType: 'VOLUME',
        resourceId: 'vol-multi',
        tags: [],
        status: 'ACTIVE',
        metadata: {
          attachments: [
            { instanceId: 'i-a', state: 'attached' },
            { instanceId: 'i-b', state: 'attached' },
          ],
        },
        discoveredAt: '2026-01-01T00:00:00.000Z',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    assert.equal(volumesAttachedToInstance(volumes, 'i-b').length, 1);
  });
});

describe('STOPPED_WITH_STORAGE volume contract', () => {
  function instance(partial: Record<string, unknown>) {
    return {
      tenantId: 't',
      accountId: 'a',
      region: 'us-east-1',
      service: 'ec2' as const,
      resourceType: 'INSTANCE' as const,
      resourceId: 'i-stopped',
      tags: [],
      status: 'ACTIVE' as const,
      metadata: { state: 'stopped', ...partial },
      discoveredAt: '2026-01-01T00:00:00.000Z',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  function volume(meta: Record<string, unknown>) {
    return {
      tenantId: 't',
      accountId: 'a',
      region: 'us-east-1',
      service: 'ec2' as const,
      resourceType: 'VOLUME' as const,
      resourceId: 'vol-1',
      tags: [],
      status: 'ACTIVE' as const,
      metadata: meta,
      discoveredAt: '2026-01-01T00:00:00.000Z',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  it('stopped instance with attached volume triggers', () => {
    const results = stoppedWithStorageRule.evaluate({
      tenantId: 't',
      accountId: 'a',
      region: 'us-east-1',
      instance: instance({}),
      volumes: [
        volume({
          sizeGiB: 50,
          volumeType: 'gp3',
          attachments: [{ instanceId: 'i-stopped', state: 'attached' }],
        }),
      ],
      analysisRunId: 'r',
      observationDays: 14,
    });
    assert.equal(results[0]?.category, 'STOPPED_WITH_STORAGE');
    assert.equal(results[0]?.currentMonthlyCost, 0);
    assert.match(results[0]?.recommendedAction ?? '', /approval/i);
    assert.doesNotMatch(results[0]?.recommendedAction ?? '', /delete automatically/i);
  });

  it('missing attachment metadata on in-use volume yields insufficient evidence', () => {
    const results = stoppedWithStorageRule.evaluate({
      tenantId: 't',
      accountId: 'a',
      region: 'us-east-1',
      instance: instance({}),
      volumes: [volume({ state: 'in-use', sizeGiB: 10, volumeType: 'gp3' })],
      analysisRunId: 'r',
      observationDays: 14,
    });
    assert.equal(results[0]?.category, 'INSUFFICIENT_DATA');
  });

  it('running instance does not trigger stopped-storage rule', () => {
    const results = stoppedWithStorageRule.evaluate({
      tenantId: 't',
      accountId: 'a',
      region: 'us-east-1',
      instance: instance({ state: 'running' }),
      volumes: [
        volume({
          attachments: [{ instanceId: 'i-stopped', state: 'attached' }],
        }),
      ],
      analysisRunId: 'r',
      observationDays: 14,
    });
    assert.equal(results.length, 0);
  });

  it('unknown EBS price does not fabricate savings', () => {
    const results = stoppedWithStorageRule.evaluate({
      tenantId: 't',
      accountId: 'a',
      region: 'us-east-1',
      instance: instance({}),
      volumes: [
        volume({
          sizeGiB: 10,
          volumeType: 'sc1',
          attachments: [{ instanceId: 'i-stopped', state: 'attached' }],
        }),
      ],
      analysisRunId: 'r',
      observationDays: 14,
    });
    assert.equal(results[0]?.pricingStatus, 'UNAVAILABLE');
    assert.equal(results[0]?.estimatedMonthlySavings, undefined);
  });
});
