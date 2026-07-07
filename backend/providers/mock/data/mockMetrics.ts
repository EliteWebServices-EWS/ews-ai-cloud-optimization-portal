/**
 * Deterministic mock CloudWatch-style metrics and utilization history.
 */

import type { ProviderMetrics } from '../../../shared/types';

export const MOCK_METRICS: Record<string, ProviderMetrics> = {
  'i-mock-001': {
    resourceId: 'i-mock-001',
    cpuUtilization: [12, 14, 11, 13, 10, 12, 15, 11, 13, 12, 14, 11, 10, 12],
    memoryUtilization: [34, 36, 33, 35, 32, 34, 37, 33, 35, 34, 36, 33, 32, 34],
    networkUtilization: [5, 6, 5, 7, 5, 6, 5, 5, 6, 5, 7, 5, 6, 5],
    period: '1h',
    datapoints: 14,
    utilizationHistory: [
      { timestamp: '2026-06-23T00:00:00Z', cpuUtilization: 11, memoryUtilization: 33, networkUtilization: 5 },
      { timestamp: '2026-06-24T00:00:00Z', cpuUtilization: 12, memoryUtilization: 34, networkUtilization: 6 },
      { timestamp: '2026-06-25T00:00:00Z', cpuUtilization: 13, memoryUtilization: 35, networkUtilization: 5 },
      { timestamp: '2026-06-26T00:00:00Z', cpuUtilization: 10, memoryUtilization: 32, networkUtilization: 5 },
      { timestamp: '2026-06-27T00:00:00Z', cpuUtilization: 12, memoryUtilization: 34, networkUtilization: 6 },
      { timestamp: '2026-06-28T00:00:00Z', cpuUtilization: 14, memoryUtilization: 36, networkUtilization: 7 },
      { timestamp: '2026-06-29T00:00:00Z', cpuUtilization: 11, memoryUtilization: 33, networkUtilization: 5 },
    ],
  },
  'i-mock-002': {
    resourceId: 'i-mock-002',
    cpuUtilization: [8, 9, 7, 10, 8, 9, 8, 7, 9, 8, 7, 8, 9, 8],
    memoryUtilization: [22, 24, 21, 23, 22, 24, 22, 21, 23, 22, 21, 22, 24, 22],
    networkUtilization: [3, 4, 3, 4, 3, 3, 4, 3, 4, 3, 3, 4, 3, 3],
    period: '1h',
    datapoints: 14,
    utilizationHistory: [
      { timestamp: '2026-06-23T00:00:00Z', cpuUtilization: 8, memoryUtilization: 22, networkUtilization: 3 },
      { timestamp: '2026-06-24T00:00:00Z', cpuUtilization: 9, memoryUtilization: 23, networkUtilization: 4 },
      { timestamp: '2026-06-25T00:00:00Z', cpuUtilization: 7, memoryUtilization: 21, networkUtilization: 3 },
      { timestamp: '2026-06-26T00:00:00Z', cpuUtilization: 10, memoryUtilization: 24, networkUtilization: 4 },
      { timestamp: '2026-06-27T00:00:00Z', cpuUtilization: 8, memoryUtilization: 22, networkUtilization: 3 },
      { timestamp: '2026-06-28T00:00:00Z', cpuUtilization: 9, memoryUtilization: 24, networkUtilization: 3 },
      { timestamp: '2026-06-29T00:00:00Z', cpuUtilization: 8, memoryUtilization: 22, networkUtilization: 4 },
    ],
  },
  'i-mock-003': {
    resourceId: 'i-mock-003',
    cpuUtilization: [18, 20, 17, 19, 18, 21, 19, 18, 20, 19, 18, 19, 20, 18],
    memoryUtilization: [45, 47, 44, 46, 45, 48, 46, 45, 47, 46, 45, 46, 47, 45],
    networkUtilization: [8, 9, 8, 10, 9, 9, 10, 8, 9, 8, 9, 10, 9, 8],
    period: '1h',
    datapoints: 14,
    utilizationHistory: [
      { timestamp: '2026-06-23T00:00:00Z', cpuUtilization: 18, memoryUtilization: 45, networkUtilization: 8 },
      { timestamp: '2026-06-24T00:00:00Z', cpuUtilization: 19, memoryUtilization: 46, networkUtilization: 9 },
      { timestamp: '2026-06-25T00:00:00Z', cpuUtilization: 17, memoryUtilization: 44, networkUtilization: 8 },
      { timestamp: '2026-06-26T00:00:00Z', cpuUtilization: 20, memoryUtilization: 47, networkUtilization: 10 },
      { timestamp: '2026-06-27T00:00:00Z', cpuUtilization: 18, memoryUtilization: 45, networkUtilization: 9 },
      { timestamp: '2026-06-28T00:00:00Z', cpuUtilization: 21, memoryUtilization: 48, networkUtilization: 9 },
      { timestamp: '2026-06-29T00:00:00Z', cpuUtilization: 19, memoryUtilization: 46, networkUtilization: 8 },
    ],
  },
  'i-mock-004': {
    resourceId: 'i-mock-004',
    cpuUtilization: [5, 6, 4, 5, 7, 5, 6, 5, 5, 6, 4, 5, 6, 5],
    memoryUtilization: [15, 16, 14, 15, 17, 15, 16, 15, 15, 16, 14, 15, 16, 15],
    networkUtilization: [2, 3, 2, 2, 3, 2, 3, 2, 2, 3, 2, 2, 3, 2],
    period: '1h',
    datapoints: 14,
    utilizationHistory: [
      { timestamp: '2026-06-23T00:00:00Z', cpuUtilization: 5, memoryUtilization: 15, networkUtilization: 2 },
      { timestamp: '2026-06-24T00:00:00Z', cpuUtilization: 6, memoryUtilization: 16, networkUtilization: 3 },
      { timestamp: '2026-06-25T00:00:00Z', cpuUtilization: 4, memoryUtilization: 14, networkUtilization: 2 },
      { timestamp: '2026-06-26T00:00:00Z', cpuUtilization: 5, memoryUtilization: 15, networkUtilization: 2 },
      { timestamp: '2026-06-27T00:00:00Z', cpuUtilization: 7, memoryUtilization: 17, networkUtilization: 3 },
      { timestamp: '2026-06-28T00:00:00Z', cpuUtilization: 5, memoryUtilization: 15, networkUtilization: 2 },
      { timestamp: '2026-06-29T00:00:00Z', cpuUtilization: 6, memoryUtilization: 16, networkUtilization: 3 },
    ],
  },
};
