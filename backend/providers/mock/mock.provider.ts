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
  MOCK_TAGS,
  MOCK_VOLUMES,
} from './data';
import { AppError } from '../../shared/utils';

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
      throw new AppError(
        'INVALID_METRICS',
        `No metrics found for resource ${resourceId}`,
        404
      );
    }
    return metrics;
  }

  async getPricing(instanceType: string, region = DEFAULT_REGION): Promise<ProviderPricing> {
    const pricing = MOCK_PRICING[instanceType];
    if (!pricing) {
      throw new AppError(
        'MALFORMED_PROVIDER_RESPONSE',
        `No pricing found for instance type ${instanceType}`,
        404
      );
    }
    return { ...pricing, region };
  }

  async getRecommendations(
    resourceType: string,
    _region = DEFAULT_REGION
  ): Promise<ProviderRecommendation[]> {
    return MOCK_RECOMMENDATIONS.filter((rec) => rec.resourceType === resourceType);
  }

  async getTags(resourceId: string, _region = DEFAULT_REGION): Promise<Record<string, string>> {
    const tags = MOCK_TAGS[resourceId];
    if (!tags) {
      throw new AppError(
        'MALFORMED_PROVIDER_RESPONSE',
        `No tags found for resource ${resourceId}`,
        404
      );
    }
    return tags;
  }
}

export function createMockProvider(): MockProvider {
  return new MockProvider();
}
