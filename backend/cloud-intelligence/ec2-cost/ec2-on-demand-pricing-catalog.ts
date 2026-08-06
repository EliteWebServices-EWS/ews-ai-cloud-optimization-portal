import { EC2_COST_MONTHLY_HOURS } from './ec2-cost-limits';
import type { Ec2CostPricingAssumptions } from './ec2-cost-models';

export const EC2_ON_DEMAND_CATALOG_VERSION = '2026-08-01-ec2-cost-v1';

/**
 * Controlled sample rates for deterministic tests — not live AWS Pricing API quotes.
 * Effective date label: 2026-08-01. Do not treat as current AWS billing prices.
 */
const INSTANCE_HOURLY_USD: Record<string, Record<string, number>> = {
  'us-east-1': {
    't3.micro': 0.0104,
    't3.small': 0.0208,
    't3.medium': 0.0416,
    't3.large': 0.0832,
    'm5.large': 0.096,
    'm5.xlarge': 0.192,
    'c5.large': 0.085,
  },
};

const EBS_GB_MONTHLY_USD: Record<string, Record<string, number>> = {
  'us-east-1': {
    gp3: 0.08,
    gp2: 0.1,
    io1: 0.125,
  },
};

const FAMILY_UPGRADE_MAP: Record<string, string> = {
  't2.micro': 't3.micro',
  't2.small': 't3.small',
  'm4.large': 'm5.large',
  'c4.large': 'c5.large',
  'r4.large': 'r5.large',
};

export const EC2_ON_DEMAND_CATALOG_PRICE_EFFECTIVE_DATE = '2026-08-01';

export function defaultPricingAssumptions(region: string): Ec2CostPricingAssumptions {
  return {
    catalogVersion: EC2_ON_DEMAND_CATALOG_VERSION,
    priceEffectiveDate: EC2_ON_DEMAND_CATALOG_PRICE_EFFECTIVE_DATE,
    pricingSource: 'CONTROLLED_CATALOG_SAMPLE',
    currency: 'USD',
    monthlyHours: EC2_COST_MONTHLY_HOURS,
    pricingModel: 'ON_DEMAND',
    tenancy: 'shared',
    operatingSystem: 'Linux',
    region,
  };
}

export function resolveInstanceHourlyUsd(
  region: string,
  instanceType: string,
): number | undefined {
  return INSTANCE_HOURLY_USD[region]?.[instanceType];
}

export function monthlyInstanceCost(region: string, instanceType: string): number | undefined {
  const hourly = resolveInstanceHourlyUsd(region, instanceType);
  if (hourly === undefined) {
    return undefined;
  }
  return Math.round(hourly * EC2_COST_MONTHLY_HOURS * 100) / 100;
}

export function monthlyEbsStorageCost(
  region: string,
  volumeType: string,
  sizeGiB: number,
): number | undefined {
  const rate = EBS_GB_MONTHLY_USD[region]?.[volumeType.toLowerCase()];
  if (rate === undefined || !Number.isFinite(sizeGiB) || sizeGiB <= 0) {
    return undefined;
  }
  return Math.round(rate * sizeGiB * 100) / 100;
}

export function computeSavings(
  current?: number,
  projected?: number,
): { monthly?: number; annual?: number } {
  if (current === undefined || projected === undefined) {
    return {};
  }
  const monthly = Math.max(0, Math.round((current - projected) * 100) / 100);
  return { monthly, annual: Math.round(monthly * 12 * 100) / 100 };
}

export function suggestFamilyUpgrade(instanceType: string): string | undefined {
  return FAMILY_UPGRADE_MAP[instanceType];
}

export function isSupportedForFamilyUpgrade(instanceType: string): boolean {
  return instanceType in FAMILY_UPGRADE_MAP;
}
