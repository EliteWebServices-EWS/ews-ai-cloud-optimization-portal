import { RepositoryConflictError, RepositoryNotFoundError, cloudResourceAccountPartitionKey, cloudResourceSortKey } from '../../database';
import {
  decodeEc2ResourceListNextToken,
  encodeEc2ResourceListNextToken,
} from '../ec2-cloud-resource-pagination';
import type {
  ClaimEc2DiscoveryRunExecutionInput,
  CompleteEc2DiscoveryRunInput,
  CreateEc2DiscoveryRunInput,
  Ec2CloudResourceRepository,
  Ec2DiscoveryRunRepository,
  Ec2ResourceListQuery,
  Ec2ResourceSummary,
  UpsertDiscoveredCloudResourceInput,
} from '../contracts/ec2-cloud-resource-repository';
import type {
  DiscoveredCloudResourceRecord,
  Ec2DiscoveryRunRecord,
  Ec2ResourceType,
} from '../models/cloud-resource-persistence-models';
import {
  buildCloudResourceCompositeKey,
  CLOUD_INTELLIGENCE_SERVICE_EC2,
} from '../models/cloud-resource-persistence-models';
import type { PageResult } from '../contracts/repository-types';
import { normalizePageSize } from '../contracts/repository-types';
import {
  applyMockStageRunExecutionReclaim,
  planStageRunExecutionClaim,
} from '../ec2-stage-run-execution-claim';

function resourceKey(input: {
  tenantId: string;
  accountId: string;
  region: string;
  resourceType: Ec2ResourceType;
  resourceId: string;
}): string {
  return buildCloudResourceCompositeKey(input);
}

function runKey(tenantId: string, accountId: string, runId: string): string {
  return `${tenantId}#${accountId}#${runId}`;
}

export class MockEc2CloudResourceRepository
  implements Ec2CloudResourceRepository, Ec2DiscoveryRunRepository
{
  private readonly resources = new Map<string, DiscoveredCloudResourceRecord>();
  private readonly runs = new Map<string, Ec2DiscoveryRunRecord>();

  async upsertDiscoveredResource(
    input: UpsertDiscoveredCloudResourceInput,
  ): Promise<DiscoveredCloudResourceRecord> {
    const key = resourceKey(input);
    const existing = this.resources.get(key);
    const now = new Date().toISOString();

    if (existing) {
      const updated: DiscoveredCloudResourceRecord = {
        ...existing,
        arn: input.arn ?? existing.arn,
        name: input.name ?? existing.name,
        tags: input.tags,
        metadata: input.metadata,
        status: input.status,
        discoveredAt: input.discoveredAt,
        lastSeenAt: input.discoveredAt,
        version: existing.version + 1,
        updatedAt: now,
      };
      this.resources.set(key, updated);
      return updated;
    }

    const created: DiscoveredCloudResourceRecord = {
      tenantId: input.tenantId,
      accountId: input.accountId,
      region: input.region,
      service: CLOUD_INTELLIGENCE_SERVICE_EC2,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      arn: input.arn,
      name: input.name,
      tags: input.tags,
      discoveredAt: input.discoveredAt,
      firstSeenAt: input.discoveredAt,
      lastSeenAt: input.discoveredAt,
      status: input.status,
      version: 1,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    this.resources.set(key, created);
    return created;
  }

  async getResource(input: {
    tenantId: string;
    accountId: string;
    region: string;
    resourceType: Ec2ResourceType;
    resourceId: string;
  }): Promise<DiscoveredCloudResourceRecord | null> {
    return this.resources.get(resourceKey(input)) ?? null;
  }

  async listResources(query: Ec2ResourceListQuery): Promise<PageResult<DiscoveredCloudResourceRecord>> {
    const limit = normalizePageSize(query.limit);
    let items = [...this.resources.values()].filter(
      (r) => r.tenantId === query.tenantId && r.accountId === query.accountId,
    );
    if (query.region) {
      items = items.filter((r) => r.region === query.region);
    }
    if (query.resourceType) {
      items = items.filter((r) => r.resourceType === query.resourceType);
    }
    if (query.status) {
      items = items.filter((r) => r.status === query.status);
    }
    items.sort((a, b) => a.resourceId.localeCompare(b.resourceId));

    let start = 0;
    if (query.nextToken) {
      const startKey = decodeEc2ResourceListNextToken(query.nextToken, query);
      if (startKey?.sk) {
        const startSk = String(startKey.sk);
        const index = items.findIndex(
          (item) =>
            cloudResourceSortKey(item.region, item.resourceType, item.resourceId) === startSk,
        );
        start = index >= 0 ? index + 1 : 0;
      }
    }
    const slice = items.slice(start, start + limit);
    const last = slice[slice.length - 1];
    return {
      items: slice,
      nextToken:
        start + slice.length < items.length && last
          ? encodeEc2ResourceListNextToken(query, {
              pk: cloudResourceAccountPartitionKey(last.tenantId, last.accountId),
              sk: cloudResourceSortKey(last.region, last.resourceType, last.resourceId),
            })
          : undefined,
    };
  }

  async listResourcesInScope(input: {
    tenantId: string;
    accountId: string;
    region: string;
    resourceType: Ec2ResourceType;
  }): Promise<DiscoveredCloudResourceRecord[]> {
    return [...this.resources.values()].filter(
      (r) =>
        r.tenantId === input.tenantId &&
        r.accountId === input.accountId &&
        r.region === input.region &&
        r.resourceType === input.resourceType,
    );
  }

  async markNotSeen(input: {
    tenantId: string;
    accountId: string;
    region: string;
    resourceType: Ec2ResourceType;
    resourceId: string;
    expectedVersion: number;
  }): Promise<DiscoveredCloudResourceRecord> {
    const key = resourceKey(input);
    const existing = this.resources.get(key);
    if (!existing) {
      throw new RepositoryNotFoundError('EC2 cloud resource not found.');
    }
    if (existing.version !== input.expectedVersion) {
      throw new RepositoryConflictError('EC2 cloud resource version conflict.');
    }
    const updated: DiscoveredCloudResourceRecord = {
      ...existing,
      status: 'NOT_SEEN',
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.resources.set(key, updated);
    return updated;
  }

  async getLatestSuccessfulRun(
    tenantId: string,
    accountId: string,
  ): Promise<Ec2DiscoveryRunRecord | null> {
    const matches = [...this.runs.values()]
      .filter(
        (r) =>
          r.tenantId === tenantId &&
          r.accountId === accountId &&
          (r.status === 'SUCCEEDED' || r.status === 'PARTIAL'),
      )
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
    return matches[0] ?? null;
  }

  async createRun(input: CreateEc2DiscoveryRunInput): Promise<Ec2DiscoveryRunRecord> {
    const now = new Date().toISOString();
    const record: Ec2DiscoveryRunRecord = {
      runId: input.runId,
      tenantId: input.tenantId,
      accountId: input.accountId,
      requestedRegions: input.requestedRegions,
      startedAt: input.startedAt,
      status: 'RUNNING',
      resourceCounts: {},
      regionsSucceeded: [],
      regionsFailed: [],
      warnings: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      executionOwnerId: input.executionOwnerId,
      leaseExpiresAt: input.leaseExpiresAt,
      attemptCount: input.attemptCount ?? 1,
    };
    this.runs.set(runKey(input.tenantId, input.accountId, input.runId), record);
    return record;
  }

  async claimExecution(input: ClaimEc2DiscoveryRunExecutionInput): Promise<Ec2DiscoveryRunRecord> {
    const existing = await this.getRun(input.tenantId, input.accountId, input.runId);
    const plan = planStageRunExecutionClaim(
      existing,
      input.nowMs,
      input.executionOwnerIdForAttempt,
    );
    if (plan.kind === 'create') {
      return this.createRun({
        runId: input.runId,
        tenantId: input.tenantId,
        accountId: input.accountId,
        requestedRegions: input.requestedRegions,
        startedAt: input.startedAt,
        executionOwnerId: plan.executionOwnerId,
        leaseExpiresAt: plan.leaseExpiresAt,
        attemptCount: plan.attemptCount,
      });
    }
    if (!existing) {
      throw new RepositoryNotFoundError('EC2 discovery run not found.');
    }
    const updated = applyMockStageRunExecutionReclaim(existing, plan);
    this.runs.set(runKey(input.tenantId, input.accountId, input.runId), updated);
    return updated;
  }

  async completeRun(input: CompleteEc2DiscoveryRunInput): Promise<Ec2DiscoveryRunRecord> {
    const key = runKey(input.tenantId, input.accountId, input.runId);
    const existing = this.runs.get(key);
    if (!existing) {
      throw new RepositoryNotFoundError('EC2 discovery run not found.');
    }
    if (existing.version !== input.expectedVersion) {
      throw new RepositoryConflictError('EC2 discovery run version conflict.');
    }
    const updated: Ec2DiscoveryRunRecord = {
      ...existing,
      status: input.status,
      completedAt: input.completedAt,
      resourceCounts: input.resourceCounts,
      regionsSucceeded: input.regionsSucceeded,
      regionsFailed: input.regionsFailed,
      warnings: input.warnings,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
      failureRetryable:
        input.status === 'FAILED' ? input.failureRetryable ?? true : undefined,
    };
    this.runs.set(key, updated);
    return updated;
  }

  async getRun(
    tenantId: string,
    accountId: string,
    runId: string,
  ): Promise<Ec2DiscoveryRunRecord | null> {
    return this.runs.get(runKey(tenantId, accountId, runId)) ?? null;
  }

  /** Test helper — compute summary without Scan. */
  buildSummary(tenantId: string, accountId: string): Ec2ResourceSummary {
    const items = [...this.resources.values()].filter(
      (r) => r.tenantId === tenantId && r.accountId === accountId,
    );
    const summary: Ec2ResourceSummary = {
      totalResources: items.length,
      instancesByState: {},
      instancesByRegion: {},
      instancesByInstanceType: {},
      resourcesByType: {},
      staleResourceCount: 0,
    };
    for (const item of items) {
      summary.resourcesByType[item.resourceType] =
        (summary.resourcesByType[item.resourceType] ?? 0) + 1;
      if (item.status === 'NOT_SEEN' || item.status === 'STALE') {
        summary.staleResourceCount += 1;
      }
      if (item.resourceType === 'INSTANCE') {
        const state = String(item.metadata.state ?? 'unknown');
        summary.instancesByState[state] = (summary.instancesByState[state] ?? 0) + 1;
        summary.instancesByRegion[item.region] =
          (summary.instancesByRegion[item.region] ?? 0) + 1;
        const instanceType = String(item.metadata.instanceType ?? 'unknown');
        summary.instancesByInstanceType[instanceType] =
          (summary.instancesByInstanceType[instanceType] ?? 0) + 1;
      }
    }
    return summary;
  }
}
