import type { Ec2CostCollectionResult, Ec2CostInstance, ProviderPricing } from '../../../shared/types';
import { lookupReferencePricing } from '../pricing/ec2-reference-pricing';
import type { Ec2CostDataSource, Ec2CostDataSourceInput } from './ec2-cost-data-source.interface';

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

/**
 * Deterministic fixture data covering all three cost-intelligence rules, so
 * Demo Mode always produces a representative finding set:
 *  - i-mockcost01: running m4.large (previous generation)
 *  - i-mockcost02: stopped for 45 days (retained)
 *  - i-mockcost03: running, missing Environment/Owner tags
 *  - i-mockcost04: running, current-generation, fully tagged (no finding)
 */
function buildMockInstances(region: string): Ec2CostInstance[] {
  return [
    {
      instanceId: 'i-mockcost01',
      instanceType: 'm4.large',
      state: 'running',
      region,
      launchTime: daysAgo(120),
      tags: { Environment: 'production', Owner: 'platform-team' },
      observedMonthlyCost: 73,
    },
    {
      instanceId: 'i-mockcost02',
      instanceType: 't3.large',
      state: 'stopped',
      region,
      launchTime: daysAgo(45),
      tags: { Environment: 'staging', Owner: 'qa-team' },
      observedMonthlyCost: 0,
    },
    {
      instanceId: 'i-mockcost03',
      instanceType: 'c6i.xlarge',
      state: 'running',
      region,
      launchTime: daysAgo(30),
      tags: {},
      observedMonthlyCost: 124,
    },
    {
      instanceId: 'i-mockcost04',
      instanceType: 't3.medium',
      state: 'running',
      region,
      launchTime: daysAgo(10),
      tags: { Environment: 'production', Owner: 'platform-team' },
      observedMonthlyCost: 30,
    },
  ];
}

export class MockEc2CostDataSource implements Ec2CostDataSource {
  public async collect(
    input: Ec2CostDataSourceInput,
  ): Promise<Ec2CostCollectionResult> {
    return {
      accountId: input.accountId,
      region: input.region,
      instances: buildMockInstances(input.region),
      collectedAt: new Date().toISOString(),
      costDataDegraded: false,
    };
  }

  public async getPricing(
    instanceType: string,
    region: string,
  ): Promise<ProviderPricing> {
    return lookupReferencePricing(instanceType, region);
  }
}
