import type { ProviderInterface } from '../../shared/interfaces';
import type {
  ProviderInstance,
  ProviderMetrics,
  ProviderPricing,
  ProviderRecommendation,
  ProviderVolume,
} from '../../shared/types';
import { DEFAULT_REGION, PROVIDER_NAMES } from '../../shared/constants';
import {
  MOCK_INSTANCES,
  MOCK_METRICS,
  MOCK_PRICING,
  MOCK_RECOMMENDATIONS,
  MOCK_VOLUMES,
} from './mock-data';

/**
 * Mock Provider — returns deterministic AWS-like data for Demo Mode.
 * No random values. No AWS SDK usage.
 */
export class MockProvider implements ProviderInterface {
  readonly name = PROVIDER_NAMES.MOCK;

  async getInstances(region = DEFAULT_REGION): Promise<ProviderInstance[]> {
    return MOCK_INSTANCES.filter((instance) => instance.region === region);
  }

  async getVolumes(region = DEFAULT_REGION): Promise<ProviderVolume[]> {
    return MOCK_VOLUMES.filter((volume) => volume.region === region);
  }

  async getMetrics(resourceId: string, _region = DEFAULT_REGION): Promise<ProviderMetrics> {
    const metrics = MOCK_METRICS[resourceId];
    if (!metrics) {
      return {
        resourceId,
        cpuUtilization: [0],
        memoryUtilization: [0],
        period: '1h',
        datapoints: 1,
      };
    }
    return metrics;
  }

  async getPricing(instanceType: string, region = DEFAULT_REGION): Promise<ProviderPricing> {
    const pricing = MOCK_PRICING[instanceType];
    if (!pricing) {
      return {
        instanceType,
        region,
        hourlyRate: 0.05,
        monthlyRate: 36.5,
        currency: 'USD',
      };
    }
    return pricing;
  }

  async getRecommendations(
    resourceType: string,
    _region = DEFAULT_REGION
  ): Promise<ProviderRecommendation[]> {
    return MOCK_RECOMMENDATIONS.filter((rec) => rec.resourceType === resourceType);
  }
}

export function createMockProvider(): MockProvider {
  return new MockProvider();
}
