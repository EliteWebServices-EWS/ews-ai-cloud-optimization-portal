import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { DescribeInstancesCommand, EC2Client } from '@aws-sdk/client-ec2';

import { withAccessDeniedRecovery } from '../../../execution/adapters/sts/aws-service-client-factory';
import { StsCredentialProvider } from '../../../execution/adapters/sts/sts-credential-provider';
import type { AwsAccountRoleConfig, StsAssumeRoleContext } from '../../../execution/adapters/sts/sts-types';
import { createLogger } from '../../../shared/utils';

import type { Ec2CostCollectionResult, Ec2CostInstance, ProviderPricing } from '../../../shared/types';
import { lookupReferencePricing } from '../pricing/ec2-reference-pricing';
import type { Ec2CostDataSource, Ec2CostDataSourceInput } from './ec2-cost-data-source.interface';

const logger = createLogger('AwsEc2CostDataSource');

const COST_EXPLORER_REGION = 'us-east-1'; // Cost Explorer is a global/us-east-1-only API.
const LOOKBACK_DAYS = 30;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toTagMap(tags: Array<{ Key?: string; Value?: string }> | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const tag of tags ?? []) {
    if (tag.Key) {
      map[tag.Key] = tag.Value ?? '';
    }
  }
  return map;
}

/**
 * Collects real EC2 inventory (DescribeInstances) and actual 30-day spend
 * per instance (Cost Explorer GetCostAndUsage grouped by RESOURCE_ID) for
 * one tenant AWS account, using STS AssumeRole credentials.
 *
 * Read-only by design: only Describe/GetCostAndUsage calls are made. This
 * intentionally reuses StsCredentialProvider and withAccessDeniedRecovery
 * from execution/adapters/sts rather than duplicating credential logic, but
 * builds its own EC2/CostExplorer clients because AwsExecutionClients (the
 * execution-adapter client bundle) does not include Cost Explorer and is
 * scoped to mutating operations.
 */
export class AwsEc2CostDataSource implements Ec2CostDataSource {
  public constructor(
    private readonly credentialProvider: StsCredentialProvider = new StsCredentialProvider(),
  ) {}

  public async collect(
    input: Ec2CostDataSourceInput,
  ): Promise<Ec2CostCollectionResult> {
    if (!input.roleArn || !input.externalId) {
      throw new Error(
        'AwsEc2CostDataSource.collect requires roleArn and externalId for the AWS account.',
      );
    }

    const roleConfig: AwsAccountRoleConfig = {
      tenantId: input.tenantId,
      roleArn: input.roleArn,
      externalId: input.externalId,
      sessionNamePrefix: 'sisum-cost-intel',
    };

    const auditContext: StsAssumeRoleContext = {
      actorId: input.requestContext.actor.userId ?? 'unknown',
      actor: input.requestContext.actor,
      requestId: input.requestContext.requestId,
      correlationId: input.requestContext.correlationId,
    };

    const credentials = async () => {
      const assumed = await this.credentialProvider.getCredentials(roleConfig, auditContext);
      return {
        accessKeyId: assumed.accessKeyId,
        secretAccessKey: assumed.secretAccessKey,
        sessionToken: assumed.sessionToken,
        expiration: assumed.expiration,
      };
    };
    const invalidateAndRefresh = () => this.credentialProvider.invalidate(roleConfig);

    const ec2Client = withAccessDeniedRecovery(
      new EC2Client({ region: input.region, credentials }),
      invalidateAndRefresh,
    );
    const costExplorerClient = withAccessDeniedRecovery(
      new CostExplorerClient({ region: COST_EXPLORER_REGION, credentials }),
      invalidateAndRefresh,
    );

    const instances = await this.describeInstances(ec2Client, input.region);
    const costByInstance = await this.collectCostByInstance(costExplorerClient);

    let costDataDegraded = false;
    for (const instance of instances) {
      const observed = costByInstance.get(instance.instanceId);
      if (observed === undefined) {
        costDataDegraded = true;
      } else {
        instance.observedMonthlyCost = observed;
      }
    }

    return {
      accountId: input.accountId,
      region: input.region,
      instances,
      collectedAt: new Date().toISOString(),
      costDataDegraded,
    };
  }

  public async getPricing(instanceType: string, region: string): Promise<ProviderPricing> {
    // See engines/cost-intelligence/pricing/ec2-reference-pricing.ts for why
    // this is a static reference table rather than a live Pricing API call.
    return lookupReferencePricing(instanceType, region);
  }

  private async describeInstances(
    ec2Client: EC2Client,
    region: string,
  ): Promise<Ec2CostInstance[]> {
    const instances: Ec2CostInstance[] = [];
    let nextToken: string | undefined;

    do {
      const response = await ec2Client.send(
        new DescribeInstancesCommand({ NextToken: nextToken }),
      );

      for (const reservation of response.Reservations ?? []) {
        for (const instance of reservation.Instances ?? []) {
          if (!instance.InstanceId || !instance.InstanceType) {
            continue;
          }
          instances.push({
            instanceId: instance.InstanceId,
            instanceType: instance.InstanceType,
            state: instance.State?.Name ?? 'unknown',
            region,
            launchTime: instance.LaunchTime?.toISOString() ?? new Date().toISOString(),
            tags: toTagMap(instance.Tags),
          });
        }
      }

      nextToken = response.NextToken;
    } while (nextToken);

    return instances;
  }

  /** Actual 30-day unblended cost per EC2 instance resource, from Cost Explorer. */
  private async collectCostByInstance(
    costExplorerClient: CostExplorerClient,
  ): Promise<Map<string, number>> {
    const costByInstance = new Map<string, number>();
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - LOOKBACK_DAYS);

    try {
      const response = await costExplorerClient.send(
        new GetCostAndUsageCommand({
          TimePeriod: { Start: isoDate(start), End: isoDate(end) },
          Granularity: 'MONTHLY',
          Metrics: ['UnblendedCost'],
          Filter: {
            Dimensions: {
              Key: 'SERVICE',
              Values: ['Amazon Elastic Compute Cloud - Compute'],
            },
          },
          GroupBy: [{ Type: 'DIMENSION', Key: 'RESOURCE_ID' }],
        }),
      );

      for (const period of response.ResultsByTime ?? []) {
        for (const group of period.Groups ?? []) {
          const resourceId = group.Keys?.[0];
          const amount = Number(group.Metrics?.UnblendedCost?.Amount ?? '0');
          if (resourceId && resourceId.startsWith('i-') && Number.isFinite(amount)) {
            costByInstance.set(
              resourceId,
              (costByInstance.get(resourceId) ?? 0) + amount,
            );
          }
        }
      }
    } catch (error) {
      // Cost Explorer requires an account-level opt-in and its own IAM grant.
      // Missing/denied access degrades gracefully to pricing-table estimates
      // instead of failing the whole analysis.
      logger.warn(
        `Cost Explorer data unavailable; falling back to pricing estimates. ` +
          `Cause: ${error instanceof Error ? error.message : String(error)}`,
        { operation: 'collectCostByInstance' },
      );
    }

    return costByInstance;
  }
}
