import type { TelemetryApplicability } from './types';

/** Rule/category semantics aligned with ec2-cost-rules.ts — no duplicate taxonomy. */
const TELEMETRY_NOT_APPLICABLE_RULE_IDS = new Set([
  'ec2.cost.stopped_with_storage',
  'ec2.cost.family_upgrade',
]);

const TELEMETRY_NOT_APPLICABLE_CATEGORIES = new Set([
  'STOPPED_WITH_STORAGE',
  'INSTANCE_FAMILY_UPGRADE',
]);

/**
 * Unknown rule/category combinations default to REQUIRED (conservative).
 * Absence of CloudWatch evidence for NOT_APPLICABLE findings does not imply NO_DATA.
 */
export function resolveTelemetryApplicability(input: {
  ruleId: string;
  category: string;
}): TelemetryApplicability {
  if (
    TELEMETRY_NOT_APPLICABLE_RULE_IDS.has(input.ruleId) ||
    TELEMETRY_NOT_APPLICABLE_CATEGORIES.has(input.category)
  ) {
    return 'NOT_APPLICABLE';
  }
  return 'REQUIRED';
}

export function resolveDataCompleteness(input: {
  telemetryApplicability: TelemetryApplicability;
  dataCompleteness?: string;
}): 'COMPLETE' | 'PARTIAL' | 'INSUFFICIENT' | 'NO_DATA' | 'NOT_APPLICABLE' {
  if (input.telemetryApplicability === 'NOT_APPLICABLE') {
    return 'NOT_APPLICABLE';
  }
  const value = input.dataCompleteness;
  if (
    value === 'COMPLETE' ||
    value === 'PARTIAL' ||
    value === 'INSUFFICIENT' ||
    value === 'NO_DATA'
  ) {
    return value;
  }
  return 'NO_DATA';
}
