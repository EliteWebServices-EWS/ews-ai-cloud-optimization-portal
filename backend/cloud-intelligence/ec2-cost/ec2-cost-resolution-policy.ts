import type { Ec2CostRecommendationRecord } from './ec2-cost-models';

export interface Ec2CostResolutionContext {
  runStatus: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  requestedRegions: string[];
  regionsFailed: string[];
  seenFindingKeys: Set<string>;
  currentRuleVersions: ReadonlyMap<string, string>;
}

/**
 * OPEN recommendations may be marked RESOLVED only after a fully SUCCEEDED analysis
 * of the same tenant/account scope. PARTIAL and FAILED runs never resolve findings.
 */
export function shouldResolveOpenRecommendation(
  rec: Ec2CostRecommendationRecord,
  ctx: Ec2CostResolutionContext,
): boolean {
  if (rec.lifecycleStatus !== 'OPEN') {
    return false;
  }
  if (ctx.runStatus !== 'SUCCEEDED') {
    return false;
  }
  if (ctx.regionsFailed.length > 0) {
    return false;
  }
  if (!ctx.requestedRegions.includes(rec.region)) {
    return false;
  }
  const expectedVersion = ctx.currentRuleVersions.get(rec.ruleId);
  if (!expectedVersion || expectedVersion !== rec.ruleVersion) {
    return false;
  }
  if (ctx.seenFindingKeys.has(rec.findingKey)) {
    return false;
  }
  return true;
}

/** Recurrence after RESOLVED reopens to OPEN; ACKNOWLEDGED/DISMISSED are preserved on update. */
export function mergeRecommendationLifecycleOnUpsert(
  existing: Ec2CostRecommendationRecord | undefined,
  requestedLifecycle: Ec2CostRecommendationRecord['lifecycleStatus'] | undefined,
): Ec2CostRecommendationRecord['lifecycleStatus'] {
  if (!existing) {
    return requestedLifecycle ?? 'OPEN';
  }
  if (existing.lifecycleStatus === 'ACKNOWLEDGED' || existing.lifecycleStatus === 'DISMISSED') {
    return existing.lifecycleStatus;
  }
  if (existing.lifecycleStatus === 'RESOLVED') {
    return 'OPEN';
  }
  return existing.lifecycleStatus;
}
