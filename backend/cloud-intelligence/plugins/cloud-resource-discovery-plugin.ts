import type { Ec2ResourceType } from '../../repositories/models/cloud-resource-persistence-models';

export interface CloudDiscoveryContext {
  tenantId: string;
  accountId: string;
  regions: string[];
  discoveredAt: string;
}

export interface CloudDiscoveryRegionalScope {
  region: string;
  resourceType: Ec2ResourceType;
  succeeded: boolean;
}

export interface DiscoveryPluginResult {
  resources: Array<{
    region: string;
    resourceType: Ec2ResourceType;
    resourceId: string;
    arn?: string;
    name?: string;
    tags: Array<{ key: string; value: string }>;
    status: 'ACTIVE';
    metadata: Record<string, unknown>;
  }>;
  warnings: string[];
  completedScopes: CloudDiscoveryRegionalScope[];
}

export interface CloudDiscoveryOptions {
  regions: string[];
}

export interface CloudResourceDiscoveryPlugin {
  readonly service: string;
  discover(
    context: CloudDiscoveryContext,
    options: CloudDiscoveryOptions,
  ): Promise<DiscoveryPluginResult>;
}
