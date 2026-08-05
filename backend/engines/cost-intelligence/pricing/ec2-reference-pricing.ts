/**
 * Static EC2 on-demand reference pricing (us-east-1, approximate, USD).
 *
 * KNOWN LIMITATION (tracked as technical debt, see handbook Volume 10):
 * SISU'M does not yet have a live AWS Pricing API integration anywhere in
 * the codebase — even the "real" AwsProvider.getPricing() is currently an
 * unimplemented stub (providers/aws/aws.provider.ts). This reference table
 * is the same category of placeholder the rest of the platform already
 * relies on (providers/mock/data/mockPricing.ts), extended to cover the
 * previous-generation families this engine needs to compare against.
 * Replacing this with a live `aws-sdk/client-pricing` lookup is a
 * documented Phase 2 follow-up, not something this sprint silently hides.
 */

import type { ProviderPricing } from '../../../shared/types';
import { DEFAULT_REGION } from '../../../shared/constants';

const HOURLY_RATES: Record<string, number> = {
  // Previous generation
  't2.micro': 0.0116,
  't2.small': 0.023,
  't2.medium': 0.0464,
  't2.large': 0.0928,
  'm4.large': 0.1,
  'm4.xlarge': 0.2,
  'm4.2xlarge': 0.4,
  'c4.large': 0.1,
  'c4.xlarge': 0.199,
  'c4.2xlarge': 0.398,
  'r4.large': 0.133,
  'r4.xlarge': 0.266,
  'm3.large': 0.133,
  'm3.xlarge': 0.266,
  'c3.large': 0.105,
  'c3.xlarge': 0.21,

  // Current generation
  't3.micro': 0.0104,
  't3.small': 0.0208,
  't3.medium': 0.0416,
  't3.large': 0.0832,
  'm6i.large': 0.096,
  'm6i.xlarge': 0.192,
  'm6i.2xlarge': 0.384,
  'c6i.large': 0.085,
  'c6i.xlarge': 0.17,
  'c6i.2xlarge': 0.34,
  'r6i.large': 0.126,
  'r6i.xlarge': 0.252,
  'm5.large': 0.096,
  'm5.xlarge': 0.192,
  'c5.large': 0.085,
  'c5.xlarge': 0.17,
};

const HOURS_PER_MONTH = 730;

/** Look up (or estimate) on-demand pricing for an EC2 instance type. */
export function lookupReferencePricing(
  instanceType: string,
  region = DEFAULT_REGION,
): ProviderPricing {
  const hourlyRate = HOURLY_RATES[instanceType];

  if (hourlyRate === undefined) {
    // Unknown type: return a zeroed estimate rather than guessing a number
    // that would silently distort a savings calculation.
    return {
      instanceType,
      region,
      hourlyRate: 0,
      monthlyRate: 0,
      currency: 'USD',
    };
  }

  return {
    instanceType,
    region,
    hourlyRate,
    monthlyRate: Math.round(hourlyRate * HOURS_PER_MONTH * 100) / 100,
    currency: 'USD',
  };
}
