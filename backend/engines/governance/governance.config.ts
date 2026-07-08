/**
 * Configurable governance thresholds and policy definitions.
 * Avoid hardcoded magic numbers in rule evaluation logic.
 */

export interface GovernanceConfig {
  /** Minimum metrics datapoints required for readiness. */
  minMetricsDatapoints: number;
  /** Minimum telemetry observation window in days. */
  minObservationWindowDays: number;
  /** Minimum candidate age in days since launch. */
  minCandidateAgeDays: number;
  /** Tags that must be present on the candidate resource. */
  requiredTags: string[];
  /** Readiness score threshold for READY status. */
  readinessScoreReady: number;
  /** Readiness score threshold for PARTIALLY_READY status. */
  readinessScorePartial: number;
  /** Environment values that require manual approval. */
  approvalRequiredEnvironments: string[];
  /** Default approver when manual approval is required. */
  defaultApprover: string;
}

/** Default governance configuration for Demo Mode. */
export const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = {
  minMetricsDatapoints: 7,
  minObservationWindowDays: 7,
  minCandidateAgeDays: 14,
  requiredTags: ['Environment', 'Team'],
  readinessScoreReady: 80,
  readinessScorePartial: 50,
  approvalRequiredEnvironments: ['production'],
  defaultApprover: 'Cloud Operations Team',
};

/** Metadata describing each registered governance policy rule. */
export interface PolicyDefinition {
  name: string;
  description: string;
  severity: import('../../shared/constants').PolicySeverity;
  configurable: boolean;
}

/** Catalog of governance policies evaluated by the Governance Engine. */
export const GOVERNANCE_POLICY_CATALOG: PolicyDefinition[] = [
  {
    name: 'required-telemetry',
    description: 'Telemetry data must be present and within the observation window',
    severity: 'HIGH',
    configurable: true,
  },
  {
    name: 'required-metrics',
    description: 'Sufficient CPU and memory metrics must be available',
    severity: 'HIGH',
    configurable: true,
  },
  {
    name: 'minimum-observation-window',
    description: 'Metrics must cover the minimum observation window',
    severity: 'MEDIUM',
    configurable: true,
  },
  {
    name: 'candidate-age-sufficient',
    description: 'Resource must have been running for the minimum required age',
    severity: 'MEDIUM',
    configurable: true,
  },
  {
    name: 'required-tags',
    description: 'Required governance tags must be present on the resource',
    severity: 'HIGH',
    configurable: true,
  },
  {
    name: 'pricing-available',
    description: 'Pricing information must be available for financial evaluation',
    severity: 'MEDIUM',
    configurable: false,
  },
  {
    name: 'recommendation-available',
    description: 'An optimization recommendation hint should be available',
    severity: 'LOW',
    configurable: false,
  },
  {
    name: 'environment-approval',
    description: 'Production workloads require manual approval before optimization',
    severity: 'HIGH',
    configurable: true,
  },
];
