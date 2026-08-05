/**
 * Pure classification rules for the EC2 Cost Intelligence Engine.
 *
 * Each rule inspects one Ec2CostInstance and returns zero or more
 * CostRuleMatch candidates. Rules do not calculate savings or confidence —
 * that stays in the Financial and Confidence engines. Rules only decide
 * *what* to flag and *why*.
 */

import { COST_FINDING_SEVERITY, COST_FINDING_TYPES } from '../../shared/constants';
import type { CostFindingSeverity, CostFindingType } from '../../shared/constants';
import type { Ec2CostInstance } from '../../shared/types';
import type { CostIntelligenceConfig } from './cost-intelligence.config';

export interface CostRuleMatch {
  findingType: CostFindingType;
  severity: CostFindingSeverity;
  reason: string;
  /** Present only for findings that suggest a specific replacement instance type. */
  suggestedInstanceType?: string;
}

function familyOf(instanceType: string): string {
  return instanceType.split('.')[0] ?? instanceType;
}

function daysSince(isoDate: string, now: Date): number {
  const started = new Date(isoDate).getTime();
  if (Number.isNaN(started)) {
    return 0;
  }
  return Math.max(0, Math.floor((now.getTime() - started) / (1000 * 60 * 60 * 24)));
}

/** Running instance on a previous-generation EC2 family with a known current-gen replacement. */
export function evaluatePreviousGenerationType(
  instance: Ec2CostInstance,
  config: CostIntelligenceConfig,
): CostRuleMatch | undefined {
  if (instance.state !== 'running') {
    return undefined;
  }

  const family = familyOf(instance.instanceType);
  if (!config.previousGenerationFamilies.includes(family)) {
    return undefined;
  }

  const replacementFamily = config.currentGenerationReplacement[family];
  if (!replacementFamily) {
    return undefined;
  }

  const size = instance.instanceType.split('.')[1];
  const suggestedInstanceType = size ? `${replacementFamily}.${size}` : undefined;

  return {
    findingType: COST_FINDING_TYPES.PREVIOUS_GENERATION_TYPE,
    severity: COST_FINDING_SEVERITY.MEDIUM,
    reason: `Instance runs on previous-generation family ${family}, which is priced higher than the equivalent current-generation ${replacementFamily} family for the same specifications.`,
    suggestedInstanceType,
  };
}

/** Stopped instance retained well past a reasonable cleanup window — still incurring EBS/snapshot cost. */
export function evaluateStoppedInstanceRetained(
  instance: Ec2CostInstance,
  config: CostIntelligenceConfig,
  now: Date = new Date(),
): CostRuleMatch | undefined {
  if (instance.state !== 'stopped') {
    return undefined;
  }

  const retainedDays = daysSince(instance.launchTime, now);
  if (retainedDays < config.stoppedRetentionThresholdDays) {
    return undefined;
  }

  return {
    findingType: COST_FINDING_TYPES.STOPPED_INSTANCE_RETAINED,
    severity: COST_FINDING_SEVERITY.LOW,
    reason: `Instance has been stopped for at least ${config.stoppedRetentionThresholdDays} days. Compute charges have ceased, but attached EBS volumes and snapshots continue to accrue storage cost until the instance is terminated or cleaned up.`,
  };
}

/** Running instance missing the tags required to attribute its cost to an owner/environment. */
export function evaluateUntaggedCostOwnershipGap(
  instance: Ec2CostInstance,
  config: CostIntelligenceConfig,
): CostRuleMatch | undefined {
  if (instance.state !== 'running') {
    return undefined;
  }

  const missingTags = config.requiredCostOwnershipTags.filter(
    (tag) => !instance.tags[tag]?.trim(),
  );

  if (missingTags.length === 0) {
    return undefined;
  }

  return {
    findingType: COST_FINDING_TYPES.UNTAGGED_COST_OWNERSHIP_GAP,
    severity: COST_FINDING_SEVERITY.LOW,
    reason: `Instance is missing required cost-ownership tag(s): ${missingTags.join(', ')}. Its spend cannot be attributed to a team or environment for chargeback or FinOps reporting.`,
  };
}

const RULES: Array<
  (instance: Ec2CostInstance, config: CostIntelligenceConfig) => CostRuleMatch | undefined
> = [
  evaluatePreviousGenerationType,
  evaluateStoppedInstanceRetained,
  evaluateUntaggedCostOwnershipGap,
];

/** Evaluate every classification rule against one instance and return all matches. */
export function classifyInstance(
  instance: Ec2CostInstance,
  config: CostIntelligenceConfig,
): CostRuleMatch[] {
  return RULES.map((rule) => rule(instance, config)).filter(
    (match): match is CostRuleMatch => match !== undefined,
  );
}
