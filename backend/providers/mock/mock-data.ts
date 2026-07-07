/**
 * Deterministic mock AWS data for Demo Mode.
 * All values are fixed — no random generation.
 */

import type {
  ProviderInstance,
  ProviderMetrics,
  ProviderPricing,
  ProviderRecommendation,
  ProviderVolume,
} from '../../shared/types';
import { DEFAULT_REGION } from '../../shared/constants';

export const MOCK_INSTANCES: ProviderInstance[] = [
  {
    instanceId: 'i-mock-001',
    instanceType: 't3.large',
    state: 'running',
    region: DEFAULT_REGION,
    launchTime: '2025-11-01T08:00:00Z',
    tags: { Environment: 'production', Name: 'web-server-01', Team: 'platform' },
  },
  {
    instanceId: 'i-mock-002',
    instanceType: 'm5.xlarge',
    state: 'running',
    region: DEFAULT_REGION,
    launchTime: '2025-10-15T12:00:00Z',
    tags: { Environment: 'development', Name: 'dev-api-01', Team: 'backend' },
  },
  {
    instanceId: 'i-mock-003',
    instanceType: 't3.medium',
    state: 'running',
    region: DEFAULT_REGION,
    launchTime: '2026-01-20T06:00:00Z',
    tags: { Environment: 'staging', Name: 'staging-worker', Team: 'data' },
  },
  {
    instanceId: 'i-mock-004',
    instanceType: 'c5.2xlarge',
    state: 'running',
    region: DEFAULT_REGION,
    launchTime: '2025-09-10T14:00:00Z',
    tags: { Environment: 'production', Name: 'analytics-batch', Team: 'data' },
  },
];

export const MOCK_VOLUMES: ProviderVolume[] = [
  {
    volumeId: 'vol-mock-001',
    sizeGb: 100,
    volumeType: 'gp3',
    state: 'in-use',
    region: DEFAULT_REGION,
    attachedTo: 'i-mock-001',
  },
  {
    volumeId: 'vol-mock-002',
    sizeGb: 250,
    volumeType: 'gp2',
    state: 'in-use',
    region: DEFAULT_REGION,
    attachedTo: 'i-mock-002',
  },
  {
    volumeId: 'vol-mock-003',
    sizeGb: 50,
    volumeType: 'gp3',
    state: 'available',
    region: DEFAULT_REGION,
  },
];

export const MOCK_METRICS: Record<string, ProviderMetrics> = {
  'i-mock-001': {
    resourceId: 'i-mock-001',
    cpuUtilization: [12, 14, 11, 13, 10, 12, 15, 11],
    memoryUtilization: [34, 36, 33, 35, 32, 34, 37, 33],
    period: '1h',
    datapoints: 8,
  },
  'i-mock-002': {
    resourceId: 'i-mock-002',
    cpuUtilization: [8, 9, 7, 10, 8, 9, 8, 7],
    memoryUtilization: [22, 24, 21, 23, 22, 24, 22, 21],
    period: '1h',
    datapoints: 8,
  },
  'i-mock-003': {
    resourceId: 'i-mock-003',
    cpuUtilization: [18, 20, 17, 19, 18, 21, 19, 18],
    memoryUtilization: [45, 47, 44, 46, 45, 48, 46, 45],
    period: '1h',
    datapoints: 8,
  },
  'i-mock-004': {
    resourceId: 'i-mock-004',
    cpuUtilization: [5, 6, 4, 5, 7, 5, 6, 5],
    memoryUtilization: [15, 16, 14, 15, 17, 15, 16, 15],
    period: '1h',
    datapoints: 8,
  },
};

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

export const MOCK_RECOMMENDATIONS: ProviderRecommendation[] = [
  {
    resourceId: 'i-mock-001',
    resourceType: 'ec2',
    action: 'resize',
    target: 't3.medium',
    reason: 'Sustained low CPU utilization over 14 days',
  },
  {
    resourceId: 'i-mock-002',
    resourceType: 'ec2',
    action: 'resize',
    target: 'm5.large',
    reason: 'Instance oversized for observed workload',
  },
  {
    resourceId: 'i-mock-004',
    resourceType: 'ec2',
    action: 'resize',
    target: 'c5.xlarge',
    reason: 'Compute instance underutilized',
  },
];
