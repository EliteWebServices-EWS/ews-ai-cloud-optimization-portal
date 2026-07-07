/**
 * Deterministic mock AWS Compute Optimizer recommendations.
 */

import type { ProviderRecommendation } from '../../../shared/types';

export const MOCK_RECOMMENDATIONS: ProviderRecommendation[] = [
  {
    resourceId: 'i-mock-001',
    resourceType: 'ec2',
    action: 'resize',
    target: 't3.medium',
    reason: 'Sustained low CPU utilization over 14 days',
    source: 'compute-optimizer',
    finding: 'Underutilized',
    estimatedMonthlySavings: 30.37,
  },
  {
    resourceId: 'i-mock-002',
    resourceType: 'ec2',
    action: 'resize',
    target: 'm5.large',
    reason: 'Instance oversized for observed workload',
    source: 'compute-optimizer',
    finding: 'Overprovisioned',
    estimatedMonthlySavings: 70.08,
  },
  {
    resourceId: 'i-mock-004',
    resourceType: 'ec2',
    action: 'resize',
    target: 'c5.xlarge',
    reason: 'Compute instance underutilized',
    source: 'compute-optimizer',
    finding: 'Underutilized',
    estimatedMonthlySavings: 124.1,
  },
];
