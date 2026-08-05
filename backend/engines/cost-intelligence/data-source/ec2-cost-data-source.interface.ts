import type { AuditActor } from '../../../audit';
import type { Ec2CostCollectionResult, ProviderPricing } from '../../../shared/types';

export interface Ec2CostDataSourceInput {
  tenantId: string;
  accountId: string;
  region: string;
  /** STS role ARN + external ID for the tenant's registered AWS account (unused in mock mode). */
  roleArn?: string;
  externalId?: string;
  /** Real caller identity + request correlation, propagated into STS AssumeRole audit context. */
  requestContext: {
    actor: AuditActor;
    requestId: string;
    correlationId: string;
  };
}

/**
 * Collects EC2 inventory + actual spend for one AWS account, and resolves
 * on-demand pricing for savings projections. Two implementations exist:
 * MockEc2CostDataSource (Demo Mode / PROVIDER_MODE=mock) and
 * AwsEc2CostDataSource (PROVIDER_MODE=aws, via STS AssumeRole).
 */
export interface Ec2CostDataSource {
  collect(input: Ec2CostDataSourceInput): Promise<Ec2CostCollectionResult>;
  getPricing(instanceType: string, region: string): Promise<ProviderPricing>;
}
