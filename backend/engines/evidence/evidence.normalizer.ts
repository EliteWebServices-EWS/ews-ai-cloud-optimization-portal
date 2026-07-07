import type {
  EvidenceInstanceBlock,
  EvidenceMetricsBlock,
  EvidencePricingBlock,
  EvidenceTelemetry,
  ProviderEvidenceBundle,
  ProviderInstance,
  ProviderMetrics,
  ProviderPricing,
  ProviderRecommendation,
} from '../../shared/types';

const OBSERVATION_WINDOW_DAYS = 14;

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Normalize a provider instance into evidence instance metadata. */
export function normalizeInstance(instance: ProviderInstance): EvidenceInstanceBlock {
  return {
    instanceId: instance.instanceId,
    instanceType: instance.instanceType,
    state: instance.state,
    region: instance.region,
    launchTime: instance.launchTime,
  };
}

/** Normalize provider metrics into telemetry and metrics blocks. */
export function normalizeMetrics(metrics: ProviderMetrics): {
  telemetry: EvidenceTelemetry;
  metrics: EvidenceMetricsBlock;
} {
  const telemetry: EvidenceTelemetry = {
    cpuUtilization: Math.round(average(metrics.cpuUtilization) * 100) / 100,
    memoryUtilization: Math.round(average(metrics.memoryUtilization) * 100) / 100,
    networkUtilization: metrics.networkUtilization
      ? Math.round(average(metrics.networkUtilization) * 100) / 100
      : undefined,
    observationWindowDays: OBSERVATION_WINDOW_DAYS,
  };

  const metricsBlock: EvidenceMetricsBlock = {
    cpuUtilization: [...metrics.cpuUtilization],
    memoryUtilization: [...metrics.memoryUtilization],
    networkUtilization: metrics.networkUtilization ? [...metrics.networkUtilization] : undefined,
    period: metrics.period,
    datapoints: metrics.datapoints,
    utilizationHistory: metrics.utilizationHistory ? [...metrics.utilizationHistory] : [],
  };

  return { telemetry, metrics: metricsBlock };
}

/** Normalize provider pricing into evidence pricing block. */
export function normalizePricing(pricing: ProviderPricing): EvidencePricingBlock {
  return {
    instanceType: pricing.instanceType,
    region: pricing.region,
    hourlyRate: pricing.hourlyRate,
    monthlyRate: pricing.monthlyRate,
    currency: pricing.currency,
  };
}

/** Normalize provider recommendations, filtering to the target resource. */
export function normalizeRecommendations(
  recommendations: ProviderRecommendation[],
  resourceId: string
): ProviderRecommendation[] {
  return recommendations
    .filter((recommendation) => recommendation.resourceId === resourceId)
    .map((recommendation) => ({ ...recommendation }));
}

/** Normalize provider tags into a plain key-value map. */
export function normalizeTags(tags: Record<string, string>): Record<string, string> {
  return { ...tags };
}

/** Normalize a full provider bundle into standardized evidence sections. */
export function normalizeProviderBundle(providerData: ProviderEvidenceBundle): {
  telemetry: EvidenceTelemetry;
  metrics: EvidenceMetricsBlock;
  pricing: EvidencePricingBlock;
  recommendations: ProviderRecommendation[];
  tags: Record<string, string>;
  instance: EvidenceInstanceBlock;
} {
  const { telemetry, metrics } = normalizeMetrics(providerData.metrics);

  return {
    telemetry,
    metrics,
    pricing: normalizePricing(providerData.pricing),
    recommendations: normalizeRecommendations(
      providerData.recommendations,
      providerData.instance.instanceId
    ),
    tags: normalizeTags(providerData.tags),
    instance: normalizeInstance(providerData.instance),
  };
}
