import type { Ec2ResourceType } from '../../../repositories/models/cloud-resource-persistence-models';
import { extractNameTag } from '../../sanitize';
import type {
  Ec2ElasticIpDto,
  Ec2ImageDto,
  Ec2InstanceDto,
  Ec2LaunchTemplateDto,
  Ec2NetworkInterfaceDto,
  Ec2PlacementGroupDto,
  Ec2RegionalInventoryDto,
  Ec2VolumeDto,
} from './ec2-discovery-client.port';
import type { DiscoveryPluginResult } from '../cloud-resource-discovery-plugin';

export function normalizeEc2RegionalInventory(
  inventory: Ec2RegionalInventoryDto,
  region: string,
): DiscoveryPluginResult['resources'] {
  const resources: DiscoveryPluginResult['resources'] = [];

  for (const instance of inventory.instances) {
    resources.push(normalizeInstance(instance, region));
  }
  for (const image of inventory.images) {
    resources.push(normalizeImage(image, region));
  }
  for (const volume of inventory.volumes) {
    resources.push(normalizeVolume(volume, region));
  }
  for (const eip of inventory.elasticIps) {
    resources.push(normalizeElasticIp(eip, region));
  }
  for (const eni of inventory.networkInterfaces) {
    resources.push(normalizeNetworkInterface(eni, region));
  }
  for (const pg of inventory.placementGroups) {
    resources.push(normalizePlacementGroup(pg, region));
  }
  for (const lt of inventory.launchTemplates) {
    resources.push(normalizeLaunchTemplate(lt, region));
  }

  return resources;
}

function baseResource(
  region: string,
  resourceType: Ec2ResourceType,
  resourceId: string,
  tags: Array<{ key: string; value: string }>,
  metadata: Record<string, unknown>,
  extras: {
    arn?: string;
    name?: string;
  } = {},
): DiscoveryPluginResult['resources'][number] {
  return {
    region,
    resourceType,
    resourceId,
    arn: extras.arn,
    name: extras.name ?? extractNameTag(tags),
    tags,
    status: 'ACTIVE',
    metadata,
  };
}

function normalizeInstance(
  instance: Ec2InstanceDto,
  region: string,
): DiscoveryPluginResult['resources'][number] {
  return baseResource(
    region,
    'INSTANCE',
    instance.instanceId,
    instance.tags,
    {
      instanceType: instance.instanceType,
      architecture: instance.architecture,
      platform: instance.platform,
      platformDetails: instance.platformDetails,
      state: instance.state,
      availabilityZone: instance.availabilityZone,
      vpcId: instance.vpcId,
      subnetId: instance.subnetId,
      privateIpAddress: instance.privateIpAddress,
      publicIpAddress: instance.publicIpAddress,
      securityGroupIds: instance.securityGroupIds,
      securityGroupNames: instance.securityGroupNames,
      iamInstanceProfileArn: instance.iamInstanceProfileArn,
      monitoringState: instance.monitoringState,
      rootDeviceType: instance.rootDeviceType,
      launchTime: instance.launchTime,
      imageId: instance.imageId,
      keyName: instance.keyName,
    },
    { name: extractNameTag(instance.tags) },
  );
}

function normalizeImage(
  image: Ec2ImageDto,
  region: string,
): DiscoveryPluginResult['resources'][number] {
  return baseResource(
    region,
    'IMAGE',
    image.imageId,
    image.tags,
    {
      architecture: image.architecture,
      state: image.state,
      ownerId: image.ownerId,
    },
    { name: image.name },
  );
}

function normalizeVolume(
  volume: Ec2VolumeDto,
  region: string,
): DiscoveryPluginResult['resources'][number] {
  const attachments = (volume.attachments ?? []).map((a) => ({
    instanceId: a.instanceId,
    deviceName: a.deviceName,
    state: a.state,
    attachTime: a.attachTime,
    deleteOnTermination: a.deleteOnTermination,
  }));
  const attachedInstanceIds = attachments
    .filter((a) => !a.state || a.state.toLowerCase() === 'attached')
    .map((a) => a.instanceId);

  return baseResource(region, 'VOLUME', volume.volumeId, volume.tags, {
    sizeGiB: volume.sizeGiB,
    volumeType: volume.volumeType,
    state: volume.state,
    availabilityZone: volume.availabilityZone,
    encrypted: volume.encrypted,
    attachments,
    attachedInstanceIds,
  });
}

function normalizeElasticIp(
  eip: Ec2ElasticIpDto,
  region: string,
): DiscoveryPluginResult['resources'][number] {
  const resourceId = eip.allocationId ?? eip.publicIp ?? 'unknown';
  return baseResource(region, 'ELASTIC_IP', resourceId, eip.tags, {
    publicIp: eip.publicIp,
    domain: eip.domain,
    instanceId: eip.instanceId,
    networkInterfaceId: eip.networkInterfaceId,
  });
}

function normalizeNetworkInterface(
  eni: Ec2NetworkInterfaceDto,
  region: string,
): DiscoveryPluginResult['resources'][number] {
  return baseResource(
    region,
    'NETWORK_INTERFACE',
    eni.networkInterfaceId,
    eni.tags,
    {
      status: eni.status,
      vpcId: eni.vpcId,
      subnetId: eni.subnetId,
      privateIpAddress: eni.privateIpAddress,
    },
  );
}

function normalizePlacementGroup(
  pg: Ec2PlacementGroupDto,
  region: string,
): DiscoveryPluginResult['resources'][number] {
  return baseResource(region, 'PLACEMENT_GROUP', pg.groupName, pg.tags, {
    strategy: pg.strategy,
    state: pg.state,
  });
}

function normalizeLaunchTemplate(
  lt: Ec2LaunchTemplateDto,
  region: string,
): DiscoveryPluginResult['resources'][number] {
  return baseResource(
    region,
    'LAUNCH_TEMPLATE',
    lt.launchTemplateId,
    lt.tags,
    {
      launchTemplateName: lt.launchTemplateName,
      defaultVersionNumber: lt.defaultVersionNumber,
      latestVersionNumber: lt.latestVersionNumber,
    },
    { name: lt.launchTemplateName },
  );
}

export function countResourcesByType(
  resources: DiscoveryPluginResult['resources'],
): Partial<Record<Ec2ResourceType, number>> {
  const counts: Partial<Record<Ec2ResourceType, number>> = {};
  for (const resource of resources) {
    const type = resource.resourceType as Ec2ResourceType;
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}
