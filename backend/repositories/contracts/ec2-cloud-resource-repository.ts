import type { PageRequest, PageResult } from './repository-types';
import type {
  DiscoveredCloudResourceRecord,
  Ec2DiscoveryRunRecord,
  Ec2ResourceType,
  CloudResourceLifecycleStatus,
} from '../models/cloud-resource-persistence-models';

export interface Ec2ResourceListQuery extends PageRequest {
  tenantId: string;
  accountId: string;
  region?: string;
  resourceType?: Ec2ResourceType;
  status?: CloudResourceLifecycleStatus;
}

export interface UpsertDiscoveredCloudResourceInput {
  tenantId: string;
  accountId: string;
  region: string;
  resourceType: Ec2ResourceType;
  resourceId: string;
  arn?: string;
  name?: string;
  tags: Array<{ key: string; value: string }>;
  status: CloudResourceLifecycleStatus;
  metadata: Record<string, unknown>;
  discoveredAt: string;
}

export interface Ec2CloudResourceRepository {
  upsertDiscoveredResource(
    input: UpsertDiscoveredCloudResourceInput,
  ): Promise<DiscoveredCloudResourceRecord>;

  getResource(input: {
    tenantId: string;
    accountId: string;
    region: string;
    resourceType: Ec2ResourceType;
    resourceId: string;
  }): Promise<DiscoveredCloudResourceRecord | null>;

  listResources(query: Ec2ResourceListQuery): Promise<PageResult<DiscoveredCloudResourceRecord>>;

  listResourcesInScope(input: {
    tenantId: string;
    accountId: string;
    region: string;
    resourceType: Ec2ResourceType;
  }): Promise<DiscoveredCloudResourceRecord[]>;

  markNotSeen(input: {
    tenantId: string;
    accountId: string;
    region: string;
    resourceType: Ec2ResourceType;
    resourceId: string;
    expectedVersion: number;
  }): Promise<DiscoveredCloudResourceRecord>;

  getLatestSuccessfulRun(
    tenantId: string,
    accountId: string,
  ): Promise<Ec2DiscoveryRunRecord | null>;
}

export interface CreateEc2DiscoveryRunInput {
  runId: string;
  tenantId: string;
  accountId: string;
  requestedRegions: string[];
  startedAt: string;
}

export interface CompleteEc2DiscoveryRunInput {
  tenantId: string;
  accountId: string;
  runId: string;
  expectedVersion: number;
  status: Ec2DiscoveryRunRecord['status'];
  completedAt: string;
  resourceCounts: Ec2DiscoveryRunRecord['resourceCounts'];
  regionsSucceeded: string[];
  regionsFailed: string[];
  warnings: string[];
}

export interface Ec2DiscoveryRunRepository {
  createRun(input: CreateEc2DiscoveryRunInput): Promise<Ec2DiscoveryRunRecord>;
  completeRun(input: CompleteEc2DiscoveryRunInput): Promise<Ec2DiscoveryRunRecord>;
  getRun(
    tenantId: string,
    accountId: string,
    runId: string,
  ): Promise<Ec2DiscoveryRunRecord | null>;
}

export interface Ec2ResourceSummary {
  totalResources: number;
  instancesByState: Record<string, number>;
  instancesByRegion: Record<string, number>;
  instancesByInstanceType: Record<string, number>;
  resourcesByType: Partial<Record<Ec2ResourceType, number>>;
  staleResourceCount: number;
  latestSuccessfulDiscoveryAt?: string;
}
