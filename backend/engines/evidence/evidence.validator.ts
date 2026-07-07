import type {
  EvidenceValidationResult,
  ProviderEvidenceBundle,
  ProviderInstance,
  ProviderMetrics,
  ProviderPricing,
  ProviderRecommendation,
} from '../../shared/types';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Validate provider instance fields required for evidence collection. */
export function validateInstance(instance: ProviderInstance): EvidenceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isNonEmptyString(instance.instanceId)) {
    errors.push('Instance ID is required');
  }
  if (!isNonEmptyString(instance.instanceType)) {
    errors.push('Instance type is required');
  }
  if (!isNonEmptyString(instance.state)) {
    errors.push('Instance state is required');
  }
  if (!isNonEmptyString(instance.region)) {
    errors.push('Instance region is required');
  }
  if (!isNonEmptyString(instance.launchTime)) {
    warnings.push('Instance launch time is missing');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Validate provider metrics completeness. */
export function validateMetrics(metrics: ProviderMetrics): EvidenceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isNonEmptyString(metrics.resourceId)) {
    errors.push('Metrics resource ID is required');
  }
  if (!Array.isArray(metrics.cpuUtilization) || metrics.cpuUtilization.length === 0) {
    errors.push('CPU utilization metrics are required');
  }
  if (!Array.isArray(metrics.memoryUtilization) || metrics.memoryUtilization.length === 0) {
    errors.push('Memory utilization metrics are required');
  }
  if (metrics.datapoints <= 0) {
    errors.push('Metrics datapoint count must be greater than zero');
  }
  if (!metrics.utilizationHistory || metrics.utilizationHistory.length === 0) {
    warnings.push('Utilization history is missing');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Validate provider pricing fields. */
export function validatePricing(pricing: ProviderPricing): EvidenceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isNonEmptyString(pricing.instanceType)) {
    errors.push('Pricing instance type is required');
  }
  if (pricing.hourlyRate <= 0) {
    errors.push('Pricing hourly rate must be greater than zero');
  }
  if (pricing.monthlyRate <= 0) {
    errors.push('Pricing monthly rate must be greater than zero');
  }
  if (!isNonEmptyString(pricing.currency)) {
    warnings.push('Pricing currency is missing');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Validate recommendations for a resource. Missing recommendations produce warnings only. */
export function validateRecommendations(
  recommendations: ProviderRecommendation[],
  resourceId: string
): EvidenceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const matches = recommendations.filter((rec) => rec.resourceId === resourceId);
  if (matches.length === 0) {
    warnings.push(`No Compute Optimizer recommendations found for ${resourceId}`);
  }

  for (const recommendation of matches) {
    if (!isNonEmptyString(recommendation.action)) {
      errors.push('Recommendation action is required');
    }
    if (!isNonEmptyString(recommendation.target)) {
      errors.push('Recommendation target is required');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Validate tags for a resource. */
export function validateTags(tags: Record<string, string>): EvidenceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (Object.keys(tags).length === 0) {
    warnings.push('Resource tags are empty');
  }

  return { valid: errors.length === 0, errors, warnings };
}

function mergeValidationResults(
  results: EvidenceValidationResult[]
): EvidenceValidationResult {
  return results.reduce<EvidenceValidationResult>(
    (merged, current) => ({
      valid: merged.valid && current.valid,
      errors: [...merged.errors, ...current.errors],
      warnings: [...merged.warnings, ...current.warnings],
    }),
    { valid: true, errors: [], warnings: [] }
  );
}

/** Validate a complete provider evidence bundle. */
export function validateProviderBundle(
  providerData: ProviderEvidenceBundle
): EvidenceValidationResult {
  return mergeValidationResults([
    validateInstance(providerData.instance),
    validateMetrics(providerData.metrics),
    validatePricing(providerData.pricing),
    validateRecommendations(providerData.recommendations, providerData.instance.instanceId),
    validateTags(providerData.tags),
  ]);
}
