/**
 * Deterministic mock resource tags keyed by instance ID.
 */

export const MOCK_TAGS: Record<string, Record<string, string>> = {
  'i-mock-001': {
    Environment: 'production',
    Name: 'web-server-01',
    Team: 'platform',
    CostCenter: 'CC-1001',
    Owner: 'cloud-ops@example.com',
  },
  'i-mock-002': {
    Environment: 'development',
    Name: 'dev-api-01',
    Team: 'backend',
    CostCenter: 'CC-2002',
    Owner: 'backend@example.com',
  },
  'i-mock-003': {
    Environment: 'staging',
    Name: 'staging-worker',
    Team: 'data',
    CostCenter: 'CC-3003',
    Owner: 'data@example.com',
  },
  'i-mock-004': {
    Environment: 'production',
    Name: 'analytics-batch',
    Team: 'data',
    CostCenter: 'CC-1004',
    Owner: 'analytics@example.com',
  },
};
