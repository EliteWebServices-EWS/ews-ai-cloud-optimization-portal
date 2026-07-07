import type { ProviderInterface } from '../../shared/interfaces';
import type {
  ProviderInstance,
  ProviderMetrics,
  ProviderPricing,
  ProviderRecommendation,
  ProviderVolume,
} from '../../shared/types';
import { DEFAULT_REGION, PROVIDER_NAMES } from '../../shared/constants';

/**
 * AWS Provider stub — placeholder for future live AWS integration.
 * Sprint 1: Not implemented. All methods throw until Sprint 2+.
 */
export class AwsProvider implements ProviderInterface {
  readonly name = PROVIDER_NAMES.AWS;

  private notImplemented(method: string): never {
    throw new Error(
      `AWS Provider.${method}() is not implemented. Use Mock Provider in Demo Mode.`
    );
  }

  async getInstances(_region = DEFAULT_REGION): Promise<ProviderInstance[]> {
    this.notImplemented('getInstances');
  }

  async getVolumes(_region = DEFAULT_REGION): Promise<ProviderVolume[]> {
    this.notImplemented('getVolumes');
  }

  async getMetrics(_resourceId: string, _region = DEFAULT_REGION): Promise<ProviderMetrics> {
    this.notImplemented('getMetrics');
  }

  async getPricing(_instanceType: string, _region = DEFAULT_REGION): Promise<ProviderPricing> {
    this.notImplemented('getPricing');
  }

  async getRecommendations(
    _resourceType: string,
    _region = DEFAULT_REGION
  ): Promise<ProviderRecommendation[]> {
    this.notImplemented('getRecommendations');
  }
}

export function createAwsProvider(): AwsProvider {
  return new AwsProvider();
}
