import type { CloudDiscoveryPluginRegistry } from '../registry/cloud-discovery-plugin-registry';
import type { Ec2CloudResourceRepository } from '../../repositories/contracts/ec2-cloud-resource-repository';
import type { Ec2DiscoveryRunRepository } from '../../repositories/contracts/ec2-cloud-resource-repository';
import type { Ec2ResourceType } from '../../repositories/models/cloud-resource-persistence-models';
import { buildCloudResourceCompositeKey } from '../../repositories/models/cloud-resource-persistence-models';
import { countResourcesByType } from '../plugins/ec2/ec2-discovery-normalizer';
import { EC2_DISCOVERY_DEFAULT_SERVICE } from '../ec2-discovery-limits';

export interface RunEc2DiscoveryInput {
  tenantId: string;
  accountId: string;
  regions: string[];
  runId: string;
  startedAt: string;
}

export interface RunEc2DiscoveryResult {
  runId: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  resourceCounts: Partial<Record<Ec2ResourceType, number>>;
  regionsSucceeded: string[];
  regionsFailed: string[];
  warnings: string[];
}

export class Ec2DiscoveryOrchestrator {
  constructor(
    private readonly pluginRegistry: CloudDiscoveryPluginRegistry,
    private readonly resources: Ec2CloudResourceRepository,
    private readonly runs: Ec2DiscoveryRunRepository,
  ) {}

  async runDiscovery(input: RunEc2DiscoveryInput): Promise<RunEc2DiscoveryResult> {
    const plugin = this.pluginRegistry.get(EC2_DISCOVERY_DEFAULT_SERVICE);
    const run = await this.runs.createRun({
      runId: input.runId,
      tenantId: input.tenantId,
      accountId: input.accountId,
      requestedRegions: input.regions,
      startedAt: input.startedAt,
    });

    const discoveredAt = input.startedAt;
    const pluginResult = await plugin.discover(
      {
        tenantId: input.tenantId,
        accountId: input.accountId,
        regions: input.regions,
        discoveredAt,
      },
      { regions: input.regions },
    );

    const seenByScope = new Map<string, Set<string>>();

    for (const resource of pluginResult.resources) {
      const scopeKey = `${resource.region}#${resource.resourceType}`;
      if (!seenByScope.has(scopeKey)) {
        seenByScope.set(scopeKey, new Set());
      }
      seenByScope.get(scopeKey)!.add(
        buildCloudResourceCompositeKey({
          tenantId: input.tenantId,
          accountId: input.accountId,
          region: resource.region,
          resourceType: resource.resourceType,
          resourceId: resource.resourceId,
        }),
      );

      await this.resources.upsertDiscoveredResource({
        tenantId: input.tenantId,
        accountId: input.accountId,
        region: resource.region,
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        arn: resource.arn,
        name: resource.name,
        tags: resource.tags,
        status: 'ACTIVE',
        metadata: resource.metadata,
        discoveredAt,
      });
    }

    for (const scope of pluginResult.completedScopes.filter(
      (s): s is typeof s & { succeeded: true } => s.succeeded,
    )) {
      const existing = await this.resources.listResourcesInScope({
        tenantId: input.tenantId,
        accountId: input.accountId,
        region: scope.region,
        resourceType: scope.resourceType,
      });
      const seen = seenByScope.get(`${scope.region}#${scope.resourceType}`) ?? new Set();
      for (const record of existing) {
        const composite = buildCloudResourceCompositeKey({
          tenantId: record.tenantId,
          accountId: record.accountId,
          region: record.region,
          resourceType: record.resourceType,
          resourceId: record.resourceId,
        });
        if (!seen.has(composite) && record.status === 'ACTIVE') {
          await this.resources.markNotSeen({
            tenantId: record.tenantId,
            accountId: record.accountId,
            region: record.region,
            resourceType: record.resourceType,
            resourceId: record.resourceId,
            expectedVersion: record.version,
          });
        }
      }
    }

    const resourceCounts = countResourcesByType(pluginResult.resources);
    const regionsSucceeded = [
      ...new Set(
        pluginResult.completedScopes
          .filter((s) => s.succeeded)
          .map((s) => s.region),
      ),
    ];
    const regionsFailed = input.regions.filter((r) => !regionsSucceeded.includes(r));

    let status: RunEc2DiscoveryResult['status'] = 'SUCCEEDED';
    if (regionsSucceeded.length === 0) {
      status = 'FAILED';
    } else if (regionsFailed.length > 0 || pluginResult.warnings.length > 0) {
      status = 'PARTIAL';
    }

    await this.runs.completeRun({
      tenantId: input.tenantId,
      accountId: input.accountId,
      runId: input.runId,
      expectedVersion: run.version,
      status,
      completedAt: new Date().toISOString(),
      resourceCounts,
      regionsSucceeded,
      regionsFailed,
      warnings: pluginResult.warnings,
    });

    return {
      runId: input.runId,
      status,
      resourceCounts,
      regionsSucceeded,
      regionsFailed,
      warnings: pluginResult.warnings,
    };
  }
}
