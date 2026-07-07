/**
 * Deterministic mock EC2 instance inventory for Demo Mode.
 */

import type { ProviderInstance } from '../../../shared/types';
import { DEFAULT_REGION } from '../../../shared/constants';

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
