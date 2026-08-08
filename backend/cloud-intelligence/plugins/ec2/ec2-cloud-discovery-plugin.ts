import { EC2Client } from '@aws-sdk/client-ec2';

import {
  CLOUD_INTELLIGENCE_SERVICE_EC2,
  type Ec2ResourceType,
} from '../../../repositories/models/cloud-resource-persistence-models';
import type {
  CloudDiscoveryContext,
  CloudDiscoveryOptions,
  CloudResourceDiscoveryPlugin,
  DiscoveryPluginResult,
} from '../cloud-resource-discovery-plugin';
import { createAwsEc2DiscoveryClient } from './aws-ec2-discovery-client';
import type { Ec2DiscoveryClientPort } from './ec2-discovery-client.port';
import {
  countResourcesByType,
  normalizeEc2RegionalInventory,
} from './ec2-discovery-normalizer';

const EC2_RESOURCE_TYPES: Ec2ResourceType[] = [
  'INSTANCE',
  'IMAGE',
  'VOLUME',
  'ELASTIC_IP',
  'NETWORK_INTERFACE',
  'PLACEMENT_GROUP',
  'LAUNCH_TEMPLATE',
];

export type Ec2DiscoveryClientFactory = (region: string) => Ec2DiscoveryClientPort;

export function createEc2DiscoveryClientFactoryFromEc2Client(
  createEc2Client: (region: string) => EC2Client,
): Ec2DiscoveryClientFactory {
  return (region: string) => createAwsEc2DiscoveryClient(createEc2Client(region));
}

export class Ec2CloudDiscoveryPlugin implements CloudResourceDiscoveryPlugin {
  readonly service = CLOUD_INTELLIGENCE_SERVICE_EC2;

  constructor(private readonly clientFactory: Ec2DiscoveryClientFactory) {}

  async discover(
    context: CloudDiscoveryContext,
    options: CloudDiscoveryOptions,
  ): Promise<DiscoveryPluginResult> {
    const resources: DiscoveryPluginResult['resources'] = [];
    const warnings: string[] = [];
    const completedScopes: DiscoveryPluginResult['completedScopes'] = [];

    for (const region of options.regions) {
      try {
        const client = this.clientFactory(region);
        const inventory = await client.discoverRegionalInventory(region);
        const normalized = normalizeEc2RegionalInventory(inventory, region);
        resources.push(...normalized);

        for (const resourceType of EC2_RESOURCE_TYPES) {
          completedScopes.push({ region, resourceType, succeeded: true });
        }
      } catch (error) {
        const code =
          error instanceof Error && error.name ? error.name : 'EC2_DISCOVERY_REGION_FAILED';
        warnings.push(`${region}:${code}`);
      }
    }

    void context;
    void countResourcesByType;

    return { resources, warnings, completedScopes };
  }
}

export function createEc2CloudDiscoveryPlugin(
  clientFactory: Ec2DiscoveryClientFactory,
): Ec2CloudDiscoveryPlugin {
  return new Ec2CloudDiscoveryPlugin(clientFactory);
}
