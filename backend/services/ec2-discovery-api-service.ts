import { randomUUID } from 'node:crypto';

import { RepositoryNotFoundError } from '../database';
import type { AwsAccountRepository } from '../repositories/contracts';
import type {
  Ec2CloudResourceRepository,
  Ec2DiscoveryRunRepository,
  Ec2ResourceListQuery,
  Ec2ResourceSummary,
} from '../repositories/contracts/ec2-cloud-resource-repository';
import type {
  DiscoveredCloudResourceRecord,
  Ec2ResourceType,
} from '../repositories/models/cloud-resource-persistence-models';
import {
  validateCloudResourceAccountId,
  validateCloudResourceRegion,
  validateEc2ResourceType,
} from '../repositories/models/cloud-resource-persistence-models';
import {
  createAssumeRoleClientFactory,
  StsCredentialProvider,
  type AwsAccountRoleConfig,
  type StsAssumeRoleContext,
} from '../execution/adapters/sts';
import { AppError } from '../shared/utils';
import { EC2Client } from '@aws-sdk/client-ec2';
import { createAwsEc2DiscoveryClient } from '../cloud-intelligence/plugins/ec2/aws-ec2-discovery-client';
import { createEc2CloudDiscoveryPlugin } from '../cloud-intelligence/plugins/ec2/ec2-cloud-discovery-plugin';
import type { Ec2DiscoveryClientFactory } from '../cloud-intelligence/plugins/ec2/ec2-cloud-discovery-plugin';
import { createCloudDiscoveryPluginRegistry } from '../cloud-intelligence/registry/cloud-discovery-plugin-registry';
import { Ec2DiscoveryOrchestrator } from '../cloud-intelligence/orchestration/ec2-discovery-orchestrator';
import { EC2_DISCOVERY_MAX_REGIONS_PER_REQUEST } from '../cloud-intelligence/ec2-discovery-limits';
import type { AuditActor } from '../audit';

export class Ec2DiscoveryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ec2DiscoveryValidationError';
  }
}

export interface Ec2DiscoveryCallContext {
  actor: AuditActor;
  requestId: string;
  correlationId: string;
}

export interface StartEc2DiscoveryInput {
  regions?: string[];
  /** When set (async worker), reuses a stable run id for idempotent stage recovery. */
  runId?: string;
  /** When set with runId, resumes a worker-claimed discovery run row. */
  resumeRunExpectedVersion?: number;
}

function dedupeRegions(regions: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const region of regions) {
    const normalized = validateCloudResourceRegion(region);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

export function resolveEc2DiscoveryRegions(
  input: StartEc2DiscoveryInput | undefined,
  accountRegion: string,
): string[] {
  const requested =
    input?.regions && input.regions.length > 0
      ? dedupeRegions(input.regions)
      : [validateCloudResourceRegion(accountRegion)];

  if (requested.length > EC2_DISCOVERY_MAX_REGIONS_PER_REQUEST) {
    throw new Ec2DiscoveryValidationError(
      `At most ${EC2_DISCOVERY_MAX_REGIONS_PER_REQUEST} regions are allowed per discovery request.`,
    );
  }

  return requested;
}

export class Ec2DiscoveryApiService {
  constructor(
    private readonly awsAccounts: AwsAccountRepository,
    private readonly resources: Ec2CloudResourceRepository,
    private readonly runs: Ec2DiscoveryRunRepository,
    private readonly credentialProvider: StsCredentialProvider = new StsCredentialProvider(),
    private readonly ec2DiscoveryClientFactory?: Ec2DiscoveryClientFactory,
  ) {}

  private async requireVerifiedAccount(tenantId: string, accountId: string) {
    const normalizedAccountId = validateCloudResourceAccountId(accountId);
    const record = await this.awsAccounts.getById(tenantId, normalizedAccountId);
    if (!record) {
      throw new RepositoryNotFoundError('AWS account connection not found.');
    }
    if (record.status !== 'VERIFIED') {
      throw new AppError(
        'AWS_ACCOUNT_NOT_VERIFIED',
        'AWS account must be VERIFIED before EC2 discovery.',
        409,
      );
    }
    return record;
  }

  private buildOrchestrator(roleConfig: AwsAccountRoleConfig, stsContext: StsAssumeRoleContext) {
    const clientFactory: Ec2DiscoveryClientFactory =
      this.ec2DiscoveryClientFactory ??
      ((region: string) => {
        const assumeFactory = createAssumeRoleClientFactory(roleConfig, {
          credentialProvider: this.credentialProvider,
          auditContext: stsContext,
        });
        const ec2 = assumeFactory(region).ec2 as EC2Client;
        return createAwsEc2DiscoveryClient(ec2);
      });
    const plugin = createEc2CloudDiscoveryPlugin(clientFactory);
    const registry = createCloudDiscoveryPluginRegistry([plugin]);
    return new Ec2DiscoveryOrchestrator(registry, this.resources, this.runs);
  }

  async startDiscovery(
    tenantId: string,
    accountId: string,
    input: StartEc2DiscoveryInput | undefined,
    context: Ec2DiscoveryCallContext,
  ) {
    const account = await this.requireVerifiedAccount(tenantId, accountId);
    const regions = resolveEc2DiscoveryRegions(input, account.region);

    const roleConfig: AwsAccountRoleConfig = {
      tenantId,
      roleArn: account.roleArn,
      externalId: account.externalId,
      sessionNamePrefix: 'sisum-ec2-discovery',
    };
    const stsContext: StsAssumeRoleContext = {
      actorId: context.actor.userId ?? 'unknown',
      actor: context.actor,
      requestId: context.requestId,
      correlationId: context.correlationId,
    };

    const orchestrator = this.buildOrchestrator(roleConfig, stsContext);
    const runId = input?.runId ?? `ec2run-${randomUUID()}`;
    const startedAt = new Date().toISOString();

    const result = await orchestrator.runDiscovery({
      tenantId,
      accountId: account.accountId,
      regions,
      runId,
      startedAt,
      resumeRunExpectedVersion: input?.resumeRunExpectedVersion,
    });

    return {
      runId: result.runId,
      status: result.status,
      accountId: account.accountId,
      regions,
      resourceCounts: result.resourceCounts,
      regionsSucceeded: result.regionsSucceeded,
      regionsFailed: result.regionsFailed,
      warnings: result.warnings,
    };
  }

  async listResources(query: Ec2ResourceListQuery) {
    validateCloudResourceAccountId(query.accountId);
    if (query.region) {
      validateCloudResourceRegion(query.region);
    }
    if (query.resourceType) {
      validateEc2ResourceType(query.resourceType);
    }
    return this.resources.listResources(query);
  }

  async getResource(input: {
    tenantId: string;
    accountId: string;
    region: string;
    resourceType: Ec2ResourceType;
    resourceId: string;
  }): Promise<DiscoveredCloudResourceRecord> {
    validateCloudResourceAccountId(input.accountId);
    validateCloudResourceRegion(input.region);
    validateEc2ResourceType(input.resourceType);
    const record = await this.resources.getResource(input);
    if (!record || record.tenantId !== input.tenantId) {
      throw new RepositoryNotFoundError('EC2 resource not found.');
    }
    return record;
  }

  async getSummary(tenantId: string, accountId: string): Promise<Ec2ResourceSummary> {
    validateCloudResourceAccountId(accountId);
    const all: DiscoveredCloudResourceRecord[] = [];
    let nextToken: string | undefined;
    do {
      const page = await this.resources.listResources({
        tenantId,
        accountId,
        limit: 100,
        nextToken,
      });
      all.push(...page.items);
      nextToken = page.nextToken;
    } while (nextToken);

    const summary: Ec2ResourceSummary = {
      totalResources: all.length,
      instancesByState: {},
      instancesByRegion: {},
      instancesByInstanceType: {},
      resourcesByType: {},
      staleResourceCount: 0,
    };
    for (const item of all) {
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
    const latest = await this.resources.getLatestSuccessfulRun(tenantId, accountId);
    summary.latestSuccessfulDiscoveryAt = latest?.completedAt;
    return summary;
  }
}
