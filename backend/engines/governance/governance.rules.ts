import type {
  Candidate,
  EvidenceValidationResult,
  PolicyResult,
  StandardizedEvidence,
} from '../../shared/types';
import { POLICY_SEVERITY, POLICY_STATUS } from '../../shared/constants';
import type { GovernanceConfig } from './governance.config';

export interface GovernanceRuleContext {
  candidate: Candidate;
  evidence: StandardizedEvidence;
  validation: EvidenceValidationResult;
  config: GovernanceConfig;
}

export interface GovernanceRule {
  name: string;
  evaluate(context: GovernanceRuleContext): PolicyResult;
}

function pass(
  name: string,
  reason: string,
  severity: PolicyResult['severity'],
  suggestedAction?: string
): PolicyResult {
  return { name, status: POLICY_STATUS.PASS, reason, severity, suggestedAction };
}

function fail(
  name: string,
  reason: string,
  severity: PolicyResult['severity'],
  suggestedAction?: string
): PolicyResult {
  return { name, status: POLICY_STATUS.FAIL, reason, severity, suggestedAction };
}

function warn(
  name: string,
  reason: string,
  severity: PolicyResult['severity'],
  suggestedAction?: string
): PolicyResult {
  return { name, status: POLICY_STATUS.WARN, reason, severity, suggestedAction };
}

function daysSince(isoDate: string): number {
  const launch = new Date(isoDate).getTime();
  const now = Date.now();
  return Math.floor((now - launch) / (1000 * 60 * 60 * 24));
}

/** Rule: required telemetry must exist with valid utilization values. */
export const requiredTelemetryRule: GovernanceRule = {
  name: 'required-telemetry',
  evaluate({ evidence }: GovernanceRuleContext): PolicyResult {
    const { telemetry } = evidence;
    const hasCpu = telemetry.cpuUtilization >= 0;
    const hasMemory = telemetry.memoryUtilization >= 0;

    if (!hasCpu || !hasMemory) {
      return fail(
        'required-telemetry',
        'Telemetry data is missing or incomplete',
        POLICY_SEVERITY.HIGH,
        'Collect CloudWatch metrics before governance evaluation'
      );
    }

    return pass(
      'required-telemetry',
      `Telemetry available — CPU ${telemetry.cpuUtilization}%, memory ${telemetry.memoryUtilization}%`,
      POLICY_SEVERITY.HIGH
    );
  },
};

/** Rule: required metrics arrays must meet minimum datapoint count. */
export const requiredMetricsRule: GovernanceRule = {
  name: 'required-metrics',
  evaluate({ evidence, config }: GovernanceRuleContext): PolicyResult {
    const { metrics } = evidence;
    const cpuCount = metrics.cpuUtilization.length;
    const memoryCount = metrics.memoryUtilization.length;

    if (cpuCount === 0 || memoryCount === 0) {
      return fail(
        'required-metrics',
        'CPU or memory metrics are empty',
        POLICY_SEVERITY.HIGH,
        'Ensure metrics collection covers the observation window'
      );
    }

    if (cpuCount < config.minMetricsDatapoints || memoryCount < config.minMetricsDatapoints) {
      return fail(
        'required-metrics',
        `Insufficient metrics — need at least ${config.minMetricsDatapoints} datapoints (CPU: ${cpuCount}, memory: ${memoryCount})`,
        POLICY_SEVERITY.HIGH,
        'Extend metrics collection period'
      );
    }

    return pass(
      'required-metrics',
      `Metrics available — ${cpuCount} CPU and ${memoryCount} memory datapoints`,
      POLICY_SEVERITY.HIGH
    );
  },
};

/** Rule: observation window must meet minimum duration. */
export const minimumObservationWindowRule: GovernanceRule = {
  name: 'minimum-observation-window',
  evaluate({ evidence, config }: GovernanceRuleContext): PolicyResult {
    const windowDays = evidence.telemetry.observationWindowDays;

    if (windowDays < config.minObservationWindowDays) {
      return fail(
        'minimum-observation-window',
        `Observation window ${windowDays} days is below minimum ${config.minObservationWindowDays} days`,
        POLICY_SEVERITY.MEDIUM,
        'Wait for additional telemetry before evaluation'
      );
    }

    return pass(
      'minimum-observation-window',
      `Observation window of ${windowDays} days meets minimum requirement`,
      POLICY_SEVERITY.MEDIUM
    );
  },
};

/** Rule: candidate must have been running for the minimum age. */
export const candidateAgeRule: GovernanceRule = {
  name: 'candidate-age-sufficient',
  evaluate({ evidence, config }: GovernanceRuleContext): PolicyResult {
    const ageDays = daysSince(evidence.instance.launchTime);

    if (ageDays < config.minCandidateAgeDays) {
      return warn(
        'candidate-age-sufficient',
        `Resource age ${ageDays} days is below recommended minimum ${config.minCandidateAgeDays} days`,
        POLICY_SEVERITY.MEDIUM,
        'Consider waiting for a longer observation period'
      );
    }

    return pass(
      'candidate-age-sufficient',
      `Resource age ${ageDays} days meets minimum requirement`,
      POLICY_SEVERITY.MEDIUM
    );
  },
};

/** Rule: required governance tags must be present. */
export const requiredTagsRule: GovernanceRule = {
  name: 'required-tags',
  evaluate({ evidence, config }: GovernanceRuleContext): PolicyResult {
    const missingTags = config.requiredTags.filter(
      (tag) => !evidence.tags[tag] || evidence.tags[tag].trim().length === 0
    );

    if (missingTags.length > 0) {
      return fail(
        'required-tags',
        `Missing required tags: ${missingTags.join(', ')}`,
        POLICY_SEVERITY.HIGH,
        `Apply tags: ${missingTags.join(', ')}`
      );
    }

    return pass(
      'required-tags',
      `All required tags present (${config.requiredTags.join(', ')})`,
      POLICY_SEVERITY.HIGH
    );
  },
};

/** Rule: pricing information must be available. */
export const pricingAvailableRule: GovernanceRule = {
  name: 'pricing-available',
  evaluate({ evidence }: GovernanceRuleContext): PolicyResult {
    const { pricing } = evidence;

    if (pricing.hourlyRate <= 0 || pricing.monthlyRate <= 0) {
      return fail(
        'pricing-available',
        'Pricing information is missing or invalid',
        POLICY_SEVERITY.MEDIUM,
        'Verify pricing data from the provider'
      );
    }

    return pass(
      'pricing-available',
      `Pricing available — ${pricing.monthlyRate} ${pricing.currency}/month`,
      POLICY_SEVERITY.MEDIUM
    );
  },
};

/** Rule: optimization recommendation hint should be available. */
export const recommendationAvailableRule: GovernanceRule = {
  name: 'recommendation-available',
  evaluate({ evidence, candidate }: GovernanceRuleContext): PolicyResult {
    const matches = evidence.recommendations.filter(
      (rec) => rec.resourceId === candidate.resourceId
    );

    if (matches.length === 0) {
      return warn(
        'recommendation-available',
        'No optimization recommendation available for this resource',
        POLICY_SEVERITY.LOW,
        'Run Compute Optimizer analysis or provide manual recommendation'
      );
    }

    return pass(
      'recommendation-available',
      `${matches.length} recommendation(s) available`,
      POLICY_SEVERITY.LOW
    );
  },
};

/** Rule: production environments require manual approval. */
export const environmentApprovalRule: GovernanceRule = {
  name: 'environment-approval',
  evaluate({ evidence, config }: GovernanceRuleContext): PolicyResult {
    const environment = (evidence.tags.Environment ?? 'unknown').toLowerCase();
    const requiresApproval = config.approvalRequiredEnvironments.some(
      (env) => env.toLowerCase() === environment
    );

    if (requiresApproval) {
      return warn(
        'environment-approval',
        `Environment "${evidence.tags.Environment}" requires manual approval`,
        POLICY_SEVERITY.HIGH,
        `Submit approval request to ${config.defaultApprover}`
      );
    }

    return pass(
      'environment-approval',
      `Environment "${evidence.tags.Environment ?? 'unknown'}" does not require manual approval`,
      POLICY_SEVERITY.HIGH
    );
  },
};

/** All registered governance rules evaluated in order. */
export const GOVERNANCE_RULES: GovernanceRule[] = [
  requiredTelemetryRule,
  requiredMetricsRule,
  minimumObservationWindowRule,
  candidateAgeRule,
  requiredTagsRule,
  pricingAvailableRule,
  recommendationAvailableRule,
  environmentApprovalRule,
];
