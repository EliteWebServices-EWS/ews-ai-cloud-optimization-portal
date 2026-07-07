import type {
  ProviderInstance,
  ProviderMetrics,
  ProviderPricing,
  ProviderRecommendation,
  ProviderVolume,
} from '../types';

/**
 * Provider abstraction layer contract.
 * Business logic must never call AWS SDKs directly — only through this interface.
 */
export interface ProviderInterface {
  readonly name: string;

  /** Retrieve compute instances from the provider. */
  getInstances(region?: string): Promise<ProviderInstance[]>;

  /** Retrieve block storage volumes from the provider. */
  getVolumes(region?: string): Promise<ProviderVolume[]>;

  /** Retrieve utilization metrics for a resource. */
  getMetrics(resourceId: string, region?: string): Promise<ProviderMetrics>;

  /** Retrieve pricing for an instance type. */
  getPricing(instanceType: string, region?: string): Promise<ProviderPricing>;

  /** Retrieve external optimization hints (e.g. Compute Optimizer). */
  getRecommendations(resourceType: string, region?: string): Promise<ProviderRecommendation[]>;

  /** Retrieve resource tags. */
  getTags(resourceId: string, region?: string): Promise<Record<string, string>>;
}
