import type { ProviderInterface } from '../../shared/interfaces';
import type { CostEstimate, PricingSummary, StandardizedEvidence } from '../../shared/types';
import { AppError } from '../../shared/utils';
import type { FinancialConfig } from './financial.config';

export interface PricingResolutionInput {
  evidence: StandardizedEvidence;
  region: string;
  provider: ProviderInterface;
  config: FinancialConfig;
}

function toCostEstimate(
  instanceType: string,
  hourlyRate: number,
  monthlyRate: number,
  currency: string
): CostEstimate {
  return {
    instanceType,
    hourlyRate,
    monthlyCost: monthlyRate,
    currency,
  };
}

/**
 * Resolve the projected instance type from provider recommendation hints in evidence.
 * Does not generate recommendations — uses existing provider hints only.
 */
export function resolveProjectedInstanceType(
  evidence: StandardizedEvidence,
  resourceId: string
): string | undefined {
  const match = evidence.recommendations.find((rec) => rec.resourceId === resourceId);
  return match?.target;
}

/**
 * Retrieve current and projected pricing through the Provider Interface.
 * Business logic remains provider-agnostic.
 */
export async function resolvePricing(input: PricingResolutionInput): Promise<PricingSummary> {
  const { evidence, region, provider, config } = input;
  const currentType = evidence.instance.instanceType;
  const projectedType = resolveProjectedInstanceType(evidence, evidence.instance.instanceId);

  if (!evidence.pricing || evidence.pricing.monthlyRate <= 0) {
    throw new AppError('MISSING_PRICING', 'Current pricing data is missing or invalid', 400);
  }

  const current: CostEstimate = toCostEstimate(
    currentType,
    evidence.pricing.hourlyRate,
    evidence.pricing.monthlyRate,
    evidence.pricing.currency || config.currency
  );

  if (!projectedType) {
    return {
      region,
      current,
      projected: { ...current },
    };
  }

  if (projectedType === currentType) {
    return {
      region,
      current,
      projected: { ...current },
    };
  }

  const projectedPricing = await provider.getPricing(projectedType, region);

  if (projectedPricing.hourlyRate <= 0 || projectedPricing.monthlyRate <= 0) {
    throw new AppError(
      'INVALID_PRICING',
      `Pricing for projected instance type ${projectedType} is invalid`,
      400
    );
  }

  const projected: CostEstimate = toCostEstimate(
    projectedType,
    projectedPricing.hourlyRate,
    projectedPricing.monthlyRate,
    projectedPricing.currency || config.currency
  );

  return { region, current, projected };
}
