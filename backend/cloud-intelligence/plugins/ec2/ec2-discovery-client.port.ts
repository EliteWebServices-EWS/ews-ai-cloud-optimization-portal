/** Narrow port — no AWS SDK types cross this boundary. */

export interface Ec2TagDto {
  key: string;
  value: string;
}

export interface Ec2InstanceDto {
  instanceId: string;
  instanceType?: string;
  architecture?: string;
  platform?: string;
  platformDetails?: string;
  state?: string;
  availabilityZone?: string;
  vpcId?: string;
  subnetId?: string;
  privateIpAddress?: string;
  publicIpAddress?: string;
  securityGroupIds: string[];
  securityGroupNames: string[];
  iamInstanceProfileArn?: string;
  monitoringState?: string;
  rootDeviceType?: string;
  launchTime?: string;
  imageId?: string;
  keyName?: string;
  tags: Ec2TagDto[];
}

export interface Ec2ImageDto {
  imageId: string;
  name?: string;
  architecture?: string;
  state?: string;
  ownerId?: string;
  tags: Ec2TagDto[];
}

export interface Ec2VolumeAttachmentDto {
  instanceId: string;
  deviceName?: string;
  state?: string;
  attachTime?: string;
  deleteOnTermination?: boolean;
}

export interface Ec2VolumeDto {
  volumeId: string;
  sizeGiB?: number;
  volumeType?: string;
  state?: string;
  availabilityZone?: string;
  encrypted?: boolean;
  attachments?: Ec2VolumeAttachmentDto[];
  tags: Ec2TagDto[];
}

export interface Ec2ElasticIpDto {
  allocationId?: string;
  publicIp?: string;
  domain?: string;
  instanceId?: string;
  networkInterfaceId?: string;
  tags: Ec2TagDto[];
}

export interface Ec2NetworkInterfaceDto {
  networkInterfaceId: string;
  status?: string;
  vpcId?: string;
  subnetId?: string;
  privateIpAddress?: string;
  tags: Ec2TagDto[];
}

export interface Ec2PlacementGroupDto {
  groupName: string;
  strategy?: string;
  state?: string;
  tags: Ec2TagDto[];
}

export interface Ec2LaunchTemplateDto {
  launchTemplateId: string;
  launchTemplateName?: string;
  defaultVersionNumber?: number;
  latestVersionNumber?: number;
  tags: Ec2TagDto[];
}

export interface Ec2RegionalInventoryDto {
  instances: Ec2InstanceDto[];
  images: Ec2ImageDto[];
  volumes: Ec2VolumeDto[];
  elasticIps: Ec2ElasticIpDto[];
  networkInterfaces: Ec2NetworkInterfaceDto[];
  placementGroups: Ec2PlacementGroupDto[];
  launchTemplates: Ec2LaunchTemplateDto[];
}

export interface Ec2DiscoveryClientPort {
  discoverRegionalInventory(region: string): Promise<Ec2RegionalInventoryDto>;
}
