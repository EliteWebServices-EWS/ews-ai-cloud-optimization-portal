import {
  DescribeAddressesCommand,
  DescribeImagesCommand,
  DescribeInstancesCommand,
  DescribeLaunchTemplatesCommand,
  DescribeNetworkInterfacesCommand,
  DescribePlacementGroupsCommand,
  DescribeVolumesCommand,
  type EC2Client,
} from '@aws-sdk/client-ec2';

import type {
  Ec2DiscoveryClientPort,
  Ec2RegionalInventoryDto,
} from './ec2-discovery-client.port';
import { sanitizeCloudResourceTags } from '../../sanitize';

async function paginate<T>(
  fetchPage: (nextToken?: string) => Promise<{ items: T[]; nextToken?: string }>,
): Promise<T[]> {
  const items: T[] = [];
  let nextToken: string | undefined;
  do {
    const page = await fetchPage(nextToken);
    items.push(...page.items);
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}

function mapTags(
  tags: { Key?: string; Value?: string }[] | undefined,
): Array<{ key: string; value: string }> {
  return sanitizeCloudResourceTags(
    tags?.map((t) => ({ key: t.Key, value: t.Value })),
  );
}

export function createAwsEc2DiscoveryClient(ec2: EC2Client): Ec2DiscoveryClientPort {
  return {
    async discoverRegionalInventory(region: string): Promise<Ec2RegionalInventoryDto> {
      void region;

      const reservations = await paginate(async (nextToken) => {
        const response = await ec2.send(
          new DescribeInstancesCommand({ NextToken: nextToken }),
        );
        return {
          items: response.Reservations ?? [],
          nextToken: response.NextToken,
        };
      });

      const instances = reservations.flatMap((reservation) =>
        (reservation.Instances ?? []).map((instance) => ({
          instanceId: instance.InstanceId ?? '',
          instanceType: instance.InstanceType,
          architecture: instance.Architecture,
          platform: instance.Platform,
          platformDetails: instance.PlatformDetails,
          state: instance.State?.Name,
          availabilityZone: instance.Placement?.AvailabilityZone,
          vpcId: instance.VpcId,
          subnetId: instance.SubnetId,
          privateIpAddress: instance.PrivateIpAddress,
          publicIpAddress: instance.PublicIpAddress,
          securityGroupIds: (instance.SecurityGroups ?? [])
            .map((g) => g.GroupId)
            .filter((id): id is string => Boolean(id)),
          securityGroupNames: (instance.SecurityGroups ?? [])
            .map((g) => g.GroupName)
            .filter((name): name is string => Boolean(name)),
          iamInstanceProfileArn: instance.IamInstanceProfile?.Arn,
          monitoringState: instance.Monitoring?.State,
          rootDeviceType: instance.RootDeviceType,
          launchTime: instance.LaunchTime?.toISOString(),
          imageId: instance.ImageId,
          keyName: instance.KeyName,
          tags: mapTags(instance.Tags),
        })),
      );

      const images = await paginate(async (nextToken) => {
        const response = await ec2.send(
          new DescribeImagesCommand({
            Owners: ['self'],
            NextToken: nextToken,
          }),
        );
        return {
          items: response.Images ?? [],
          nextToken: response.NextToken,
        };
      });

      const volumes = await paginate(async (nextToken) => {
        const response = await ec2.send(
          new DescribeVolumesCommand({ NextToken: nextToken }),
        );
        return {
          items: response.Volumes ?? [],
          nextToken: response.NextToken,
        };
      });

      const addressesResponse = await ec2.send(new DescribeAddressesCommand({}));
      const addresses = addressesResponse.Addresses ?? [];

      const networkInterfaces = await paginate(async (nextToken) => {
        const response = await ec2.send(
          new DescribeNetworkInterfacesCommand({ NextToken: nextToken }),
        );
        return {
          items: response.NetworkInterfaces ?? [],
          nextToken: response.NextToken,
        };
      });

      const placementGroupsResponse = await ec2.send(new DescribePlacementGroupsCommand({}));
      const placementGroups = placementGroupsResponse.PlacementGroups ?? [];

      const launchTemplates = await paginate(async (nextToken) => {
        const response = await ec2.send(
          new DescribeLaunchTemplatesCommand({ NextToken: nextToken }),
        );
        return {
          items: response.LaunchTemplates ?? [],
          nextToken: response.NextToken,
        };
      });

      return {
        instances: instances.filter((i) => i.instanceId),
        images: images.map((image) => ({
          imageId: image.ImageId ?? '',
          name: image.Name,
          architecture: image.Architecture,
          state: image.State,
          ownerId: image.OwnerId,
          tags: mapTags(image.Tags),
        })).filter((i) => i.imageId),
        volumes: volumes.map((volume) => ({
          volumeId: volume.VolumeId ?? '',
          sizeGiB: volume.Size,
          volumeType: volume.VolumeType,
          state: volume.State,
          availabilityZone: volume.AvailabilityZone,
          encrypted: volume.Encrypted,
          attachments: (volume.Attachments ?? [])
            .map((attachment) => ({
              instanceId: attachment.InstanceId ?? '',
              deviceName: attachment.Device,
              state: attachment.State,
              attachTime: attachment.AttachTime?.toISOString(),
              deleteOnTermination: attachment.DeleteOnTermination,
            }))
            .filter((a) => a.instanceId),
          tags: mapTags(volume.Tags),
        })).filter((v) => v.volumeId),
        elasticIps: addresses.map((address) => ({
          allocationId: address.AllocationId,
          publicIp: address.PublicIp,
          domain: address.Domain,
          instanceId: address.InstanceId,
          networkInterfaceId: address.NetworkInterfaceId,
          tags: mapTags(address.Tags),
        })),
        networkInterfaces: networkInterfaces.map((eni) => ({
          networkInterfaceId: eni.NetworkInterfaceId ?? '',
          status: eni.Status,
          vpcId: eni.VpcId,
          subnetId: eni.SubnetId,
          privateIpAddress: eni.PrivateIpAddress,
          tags: mapTags(eni.TagSet),
        })).filter((e) => e.networkInterfaceId),
        placementGroups: placementGroups.map((group) => ({
          groupName: group.GroupName ?? '',
          strategy: group.Strategy,
          state: group.State,
          tags: mapTags(group.Tags),
        })).filter((g) => g.groupName),
        launchTemplates: launchTemplates.map((lt) => ({
          launchTemplateId: lt.LaunchTemplateId ?? '',
          launchTemplateName: lt.LaunchTemplateName,
          defaultVersionNumber: lt.DefaultVersionNumber,
          latestVersionNumber: lt.LatestVersionNumber,
          tags: mapTags(lt.Tags),
        })).filter((lt) => lt.launchTemplateId),
      };
    },
  };
}
