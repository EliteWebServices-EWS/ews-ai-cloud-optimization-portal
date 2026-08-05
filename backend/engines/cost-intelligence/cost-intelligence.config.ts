/**
 * Configurable thresholds for the EC2 Cost Intelligence Engine.
 */

export interface CostIntelligenceConfig {
  /** Instance type prefixes considered previous-generation (cost-inefficient) EC2 families. */
  previousGenerationFamilies: string[];
  /** Suggested current-generation replacement for each previous-generation family prefix. */
  currentGenerationReplacement: Record<string, string>;
  /** Tag keys that must be present for a running instance to be considered cost-attributable. */
  requiredCostOwnershipTags: string[];
  /** Minimum number of days a "stopped" instance must remain stopped before it is flagged. */
  stoppedRetentionThresholdDays: number;
  /** Minimum monthly savings (USD) for a finding to be reported. */
  minMonthlySavingsThreshold: number;
}

export const DEFAULT_COST_INTELLIGENCE_CONFIG: CostIntelligenceConfig = {
  previousGenerationFamilies: ['t2', 'm4', 'c4', 'r4', 'm3', 'c3'],
  currentGenerationReplacement: {
    t2: 't3',
    m4: 'm6i',
    c4: 'c6i',
    r4: 'r6i',
    m3: 'm5',
    c3: 'c5',
  },
  requiredCostOwnershipTags: ['Environment', 'Owner'],
  stoppedRetentionThresholdDays: 14,
  minMonthlySavingsThreshold: 1,
};
