import { AWS_ACCOUNT_ID_PATTERN, AWS_REGION_PATTERN } from './aws-account-persistence-models';

export const CLOUD_INTELLIGENCE_SERVICE_EC2 = 'ec2' as const;

export type CloudIntelligenceService = typeof CLOUD_INTELLIGENCE_SERVICE_EC2;

export const EC2_RESOURCE_TYPES = [
  'INSTANCE',
  'IMAGE',
  'VOLUME',
  'ELASTIC_IP',
  'NETWORK_INTERFACE',
  'PLACEMENT_GROUP',
  'LAUNCH_TEMPLATE',
] as const;

export type Ec2ResourceType = (typeof EC2_RESOURCE_TYPES)[number];

export type CloudResourceLifecycleStatus =
  | 'ACTIVE'
  | 'NOT_SEEN'
  | 'STALE';

export interface CloudResourceTag {
  key: string;
  value: string;
}

export interface DiscoveredCloudResourceRecord {
  tenantId: string;
  accountId: string;
  region: string;
  service: CloudIntelligenceService;
  resourceType: Ec2ResourceType;
  resourceId: string;
  arn?: string;
  name?: string;
  tags: CloudResourceTag[];
  discoveredAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
  status: CloudResourceLifecycleStatus;
  version: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type Ec2DiscoveryRunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'PARTIAL'
  | 'FAILED';

export interface Ec2DiscoveryRunRecord {
  runId: string;
  tenantId: string;
  accountId: string;
  requestedRegions: string[];
  startedAt: string;
  completedAt?: string;
  status: Ec2DiscoveryRunStatus;
  resourceCounts: Partial<Record<Ec2ResourceType, number>>;
  regionsSucceeded: string[];
  regionsFailed: string[];
  warnings: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function validateEc2ResourceType(value: string): Ec2ResourceType {
  if (!(EC2_RESOURCE_TYPES as readonly string[]).includes(value)) {
    throw new Error(`Invalid EC2 resourceType: ${value}`);
  }
  return value as Ec2ResourceType;
}

export function validateCloudResourceRegion(region: string): string {
  const trimmed = region.trim();
  if (!AWS_REGION_PATTERN.test(trimmed)) {
    throw new Error(`Invalid AWS region: ${region}`);
  }
  return trimmed;
}

export function validateCloudResourceAccountId(accountId: string): string {
  const trimmed = accountId.trim();
  if (!AWS_ACCOUNT_ID_PATTERN.test(trimmed)) {
    throw new Error(`Invalid AWS accountId: ${accountId}`);
  }
  return trimmed;
}

export function buildCloudResourceCompositeKey(input: {
  tenantId: string;
  accountId: string;
  region: string;
  resourceType: Ec2ResourceType;
  resourceId: string;
}): string {
  return [
    input.tenantId,
    input.accountId,
    input.region,
    input.resourceType,
    input.resourceId,
  ].join('#');
}
