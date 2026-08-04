import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DescribeAddressesCommand,
  DescribeImagesCommand,
  DescribeInstancesCommand,
  DescribeLaunchTemplatesCommand,
  DescribeNetworkInterfacesCommand,
  DescribePlacementGroupsCommand,
  DescribeVolumesCommand,
} from '@aws-sdk/client-ec2';

import { createAwsEc2DiscoveryClient } from '../../cloud-intelligence/plugins/ec2/aws-ec2-discovery-client';
import { normalizeEc2RegionalInventory } from '../../cloud-intelligence/plugins/ec2/ec2-discovery-normalizer';

describe('EC2 discovery adapter', () => {
  it('paginates DescribeInstances and uses Owners self for DescribeImages', async () => {
    const calls: unknown[] = [];
    const ec2 = {
      send: async (command: unknown) => {
        calls.push(command);
        if (command instanceof DescribeInstancesCommand) {
          const token = command.input.NextToken;
          if (!token) {
            return {
              Reservations: [{ Instances: [{ InstanceId: 'i-1', Tags: [{ Key: 'Name', Value: 'n1' }] }] }],
              NextToken: 'page-2',
            };
          }
          return {
            Reservations: [{ Instances: [{ InstanceId: 'i-2', Tags: [] }] }],
          };
        }
        if (command instanceof DescribeImagesCommand) {
          assert.deepEqual(command.input.Owners, ['self']);
          return { Images: [{ ImageId: 'ami-1', Tags: [] }] };
        }
        if (command instanceof DescribeVolumesCommand) {
          return { Volumes: [{ VolumeId: 'vol-1', Tags: [] }] };
        }
        return {};
      },
    };

    const client = createAwsEc2DiscoveryClient(ec2 as never);
    const inventory = await client.discoverRegionalInventory('us-east-1');
    assert.equal(inventory.instances.length, 2);
    const normalized = normalizeEc2RegionalInventory(inventory, 'us-east-1');
    assert.equal(normalized.find((r) => r.resourceId === 'i-1')?.name, 'n1');
    assert.ok(calls.some((c) => c instanceof DescribeImagesCommand));
  });

  it('calls DescribeAddresses and DescribePlacementGroups once without pagination', async () => {
    let addressCalls = 0;
    let pgCalls = 0;
    const ec2 = {
      send: async (command: unknown) => {
        if (command instanceof DescribeAddressesCommand) {
          addressCalls += 1;
          return { Addresses: [] };
        }
        if (command instanceof DescribePlacementGroupsCommand) {
          pgCalls += 1;
          return { PlacementGroups: [] };
        }
        if (command instanceof DescribeInstancesCommand) {
          return { Reservations: [] };
        }
        if (command instanceof DescribeImagesCommand) {
          return { Images: [] };
        }
        if (command instanceof DescribeVolumesCommand) {
          return { Volumes: [] };
        }
        if (command instanceof DescribeNetworkInterfacesCommand) {
          return { NetworkInterfaces: [] };
        }
        if (command instanceof DescribeLaunchTemplatesCommand) {
          return { LaunchTemplates: [] };
        }
        return {};
      },
    };
    await createAwsEc2DiscoveryClient(ec2 as never).discoverRegionalInventory('us-east-1');
    assert.equal(addressCalls, 1);
    assert.equal(pgCalls, 1);
  });

  it('paginates launch templates and network interfaces', async () => {
    const ec2 = {
      send: async (command: unknown) => {
        if (command instanceof DescribeLaunchTemplatesCommand) {
          const token = command.input.NextToken;
          return token
            ? { LaunchTemplates: [{ LaunchTemplateId: 'lt-2', Tags: [] }] }
            : {
                LaunchTemplates: [{ LaunchTemplateId: 'lt-1', Tags: [] }],
                NextToken: 'lt-page-2',
              };
        }
        if (command instanceof DescribeNetworkInterfacesCommand) {
          const token = command.input.NextToken;
          return token
            ? { NetworkInterfaces: [{ NetworkInterfaceId: 'eni-2', Tags: [] }] }
            : {
                NetworkInterfaces: [{ NetworkInterfaceId: 'eni-1', Tags: [] }],
                NextToken: 'eni-page-2',
              };
        }
        if (command instanceof DescribeInstancesCommand) {
          return { Reservations: [] };
        }
        if (command instanceof DescribeImagesCommand) {
          return { Images: [] };
        }
        if (command instanceof DescribeVolumesCommand) {
          return { Volumes: [] };
        }
        if (command instanceof DescribeAddressesCommand) {
          return { Addresses: [] };
        }
        if (command instanceof DescribePlacementGroupsCommand) {
          return { PlacementGroups: [] };
        }
        return {};
      },
    };
    const inventory = await createAwsEc2DiscoveryClient(ec2 as never).discoverRegionalInventory(
      'us-east-1',
    );
    assert.equal(inventory.launchTemplates.length, 2);
    assert.equal(inventory.networkInterfaces.length, 2);
  });

  it('does not persist secret-like tags in normalized output', async () => {
    const ec2 = {
      send: async (command: unknown) => {
        if (command instanceof DescribeInstancesCommand) {
          return {
            Reservations: [
              {
                Instances: [
                  {
                    InstanceId: 'i-sec',
                    Tags: [
                      { Key: 'Name', Value: 'ok' },
                      { Key: 'SecretToken', Value: 'hidden' },
                    ],
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
    const normalized = normalizeEc2RegionalInventory(inventory, 'us-east-1');
    assert.equal(normalized[0].tags.length, 1);
    assert.equal(normalized[0].tags[0].key, 'Name');
  });
});
