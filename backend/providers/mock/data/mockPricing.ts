/**
 * Deterministic mock EC2 pricing data.
 */

import type { ProviderPricing } from '../../../shared/types';
import { DEFAULT_REGION } from '../../../shared/constants';

export const MOCK_PRICING: Record<string, ProviderPricing> = {
  't3.large': {
    instanceType: 't3.large',
    region: DEFAULT_REGION,
    hourlyRate: 0.0832,
    monthlyRate: 60.74,
    currency: 'USD',
  },
  't3.medium': {
    instanceType: 't3.medium',
    region: DEFAULT_REGION,
    hourlyRate: 0.0416,
    monthlyRate: 30.37,
    currency: 'USD',
  },
  'm5.xlarge': {
    instanceType: 'm5.xlarge',
    region: DEFAULT_REGION,
    hourlyRate: 0.192,
    monthlyRate: 140.16,
    currency: 'USD',
  },
  'm5.large': {
    instanceType: 'm5.large',
    region: DEFAULT_REGION,
    hourlyRate: 0.096,
    monthlyRate: 70.08,
    currency: 'USD',
  },
  'c5.2xlarge': {
    instanceType: 'c5.2xlarge',
    region: DEFAULT_REGION,
    hourlyRate: 0.34,
    monthlyRate: 248.2,
    currency: 'USD',
  },
  'c5.xlarge': {
    instanceType: 'c5.xlarge',
    region: DEFAULT_REGION,
    hourlyRate: 0.17,
    monthlyRate: 124.1,
    currency: 'USD',
  },
};
