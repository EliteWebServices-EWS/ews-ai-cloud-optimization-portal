import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
  DescribeImagesCommand,
  DescribeVolumesCommand,
  DescribeAddressesCommand,
  DescribeNetworkInterfacesCommand,
  DescribePlacementGroupsCommand,
  DescribeLaunchTemplatesCommand,
} from '@aws-sdk/client-ec2';

import { createAwsEc2DiscoveryClient } from '../../cloud-intelligence/plugins/ec2/aws-ec2-discovery-client';
import { normalizeEc2RegionalInventory } from '../../cloud-intelligence/plugins/ec2/ec2-discovery-normalizer';
import { mapDiscoveredInstanceToSecurityInventory } from '../../cloud-intelligence/ec2-security/ec2-security-inventory-mapper';
import { analyzeEc2Security } from '../../engines/ec2-security';

describe('EC2 discovery security group evidence', () => {
  it('paginates DescribeSecurityGroups once per region batch and maps ingress to instances', async () => {
    let sgCalls = 0;
    const ec2 = {
      send: async (command: unknown) => {
        if (command instanceof DescribeSecurityGroupsCommand) {
          sgCalls += 1;
          const token = command.input.NextToken;
          if (!token) {
            return {
              SecurityGroups: [
                {
                  GroupId: 'sg-ssh',
                  GroupName: 'ssh-open',
                  IpPermissions: [
                    {
                      IpProtocol: 'tcp',
                      FromPort: 22,
                      ToPort: 22,
                      IpRanges: [{ CidrIp: '0.0.0.0/0' }],
                      Ipv6Ranges: [{ CidrIpv6: '::/0' }],
                    },
                  ],
                },
              ],
              NextToken: 'sg-page-2',
            };
          }
          return {
            SecurityGroups: [
              {
                GroupId: 'sg-rdp',
                GroupName: 'rdp-open',
                IpPermissions: [
                  {
                    IpProtocol: 'tcp',
                    FromPort: 3389,
                    ToPort: 3389,
                    IpRanges: [{ CidrIp: '0.0.0.0/0' }],
                  },
                ],
              },
            ],
          };
        }
        if (command instanceof DescribeInstancesCommand) {
          return {
            Reservations: [
              {
                Instances: [
                  {
                    InstanceId: 'i-1',
                    SecurityGroups: [
                      { GroupId: 'sg-ssh', GroupName: 'ssh-open' },
                      { GroupId: 'sg-rdp', GroupName: 'rdp-open' },
                    ],
                    Monitoring: { State: 'enabled' },
                    IamInstanceProfile: { Arn: 'arn:aws:iam::123:instance-profile/app' },
                    MetadataOptions: { HttpTokens: 'required' },
                    Tags: [],
                  },
                  {
                    InstanceId: 'i-2',
                    SecurityGroups: [{ GroupId: 'sg-ssh', GroupName: 'ssh-open' }],
                    MetadataOptions: { HttpTokens: 'optional' },
                    Tags: [],
                  },
                ],
              },
            ],
          };
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
        if (command instanceof DescribeNetworkInterfacesCommand) {
          return { NetworkInterfaces: [] };
        }
        if (command instanceof DescribePlacementGroupsCommand) {
          return { PlacementGroups: [] };
        }
        if (command instanceof DescribeLaunchTemplatesCommand) {
          return { LaunchTemplates: [] };
        }
        return {};
      },
    };

    const client = createAwsEc2DiscoveryClient(ec2 as never);
    const inventory = await client.discoverRegionalInventory('us-east-1');
    assert.equal(inventory.instances.length, 2);
    assert.equal(sgCalls, 2);
    assert.equal(inventory.instances[0]?.securityGroups?.[0]?.inboundRules?.[0]?.ipv4Ranges?.[0], '0.0.0.0/0');

    const normalized = normalizeEc2RegionalInventory(inventory, 'us-east-1');
    const instanceRow = normalized.find((row) => row.resourceId === 'i-1');
    assert.ok(instanceRow);
    const metadata = instanceRow.metadata as {
      securityGroups?: unknown;
      metadataOptions?: { httpTokens?: string };
      monitoringState?: string;
      iamInstanceProfileArn?: string;
    };
    assert.ok(Array.isArray(metadata.securityGroups));
    assert.equal(metadata.metadataOptions?.httpTokens, 'required');
    assert.equal(metadata.monitoringState, 'enabled');
    assert.equal(metadata.iamInstanceProfileArn, 'arn:aws:iam::123:instance-profile/app');
    assert.equal(JSON.stringify(metadata).includes('$metadata'), false);

    const mapped = mapDiscoveredInstanceToSecurityInventory(
      {
        tenantId: 't',
        accountId: '111122223333',
        region: 'us-east-1',
        service: 'ec2',
        resourceType: 'INSTANCE',
        resourceId: 'i-1',
        tags: [],
        status: 'ACTIVE',
        metadata: instanceRow.metadata as Record<string, unknown>,
        version: 1,
        discoveredAt: '2026-01-01T00:00:00.000Z',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      [],
    );
    const analysis = analyzeEc2Security([mapped]);
    const checks = analysis.results[0]?.securityFindings.map((f) => f.check) ?? [];
    assert.ok(checks.includes('unrestricted_ssh'));
    assert.ok(checks.includes('unrestricted_rdp'));
    assert.equal(checks.includes('imdsv2_enforcement'), false);
  });

  it('handles all-traffic protocol and ignores closed ports', async () => {
    const ec2 = {
      send: async (command: unknown) => {
        if (command instanceof DescribeSecurityGroupsCommand) {
          return {
            SecurityGroups: [
              {
                GroupId: 'sg-all',
                IpPermissions: [
                  { IpProtocol: '-1', IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
                  {
                    IpProtocol: 'tcp',
                    FromPort: 443,
                    ToPort: 443,
                    IpRanges: [{ CidrIp: '10.0.0.0/8' }],
                  },
                ],
              },
            ],
          };
        }
        if (command instanceof DescribeInstancesCommand) {
          return {
            Reservations: [
              {
                Instances: [
                  {
                    InstanceId: 'i-all',
                    SecurityGroups: [{ GroupId: 'sg-all' }],
                    Tags: [],
                  },
                ],
              },
            ],
          };
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
        if (command instanceof DescribeNetworkInterfacesCommand) {
          return { NetworkInterfaces: [] };
        }
        if (command instanceof DescribePlacementGroupsCommand) {
          return { PlacementGroups: [] };
        }
        if (command instanceof DescribeLaunchTemplatesCommand) {
          return { LaunchTemplates: [] };
        }
        return {};
      },
    };
    const inventory = await createAwsEc2DiscoveryClient(ec2 as never).discoverRegionalInventory('eu-west-1');
    const mapped = mapDiscoveredInstanceToSecurityInventory(
      {
        tenantId: 't',
        accountId: '111122223333',
        region: 'eu-west-1',
        service: 'ec2',
        resourceType: 'INSTANCE',
        resourceId: 'i-all',
        tags: [],
        status: 'ACTIVE',
        metadata: normalizeEc2RegionalInventory(inventory, 'eu-west-1')[0]?.metadata ?? {},
        version: 1,
        discoveredAt: '2026-01-01T00:00:00.000Z',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      [],
    );
    const checks =
      analyzeEc2Security([mapped]).results[0]?.securityFindings.map((f) => f.check) ?? [];
    assert.ok(checks.includes('unrestricted_ssh'));
    assert.ok(checks.includes('unrestricted_rdp'));
  });
});
