import { createHash } from 'node:crypto';

import { stableStringify } from './canonical-json';
import type { RecommendationFingerprintInput } from './types';
import { PersistenceDataQualityError } from './errors';

const FINGERPRINT_VERSION = 1;

export function buildRecommendationFingerprintInputFromEc2Cost(input: {
  service: 'ec2';
  resourceType: string;
  resourceId: string;
  region: string;
  category: string;
  recommendedAction: string;
  ruleId: string;
  ruleVersion: string;
  currentInstanceType?: string;
  candidateInstanceType?: string;
  observedValues?: Record<string, unknown>;
  thresholds?: Record<string, unknown>;
}): RecommendationFingerprintInput {
  return {
    service: input.service,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    region: input.region,
    category: input.category,
    recommendedAction: input.recommendedAction,
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion,
    currentInstanceType: input.currentInstanceType,
    candidateInstanceType: input.candidateInstanceType,
    observedValues: input.observedValues ?? {},
    thresholds: input.thresholds ?? {},
  };
}

export function assertFingerprintInput(input: RecommendationFingerprintInput): void {
  const required: Array<[string, string]> = [
    ['service', input.service],
    ['resourceType', input.resourceType],
    ['resourceId', input.resourceId],
    ['region', input.region],
    ['category', input.category],
    ['recommendedAction', input.recommendedAction],
    ['ruleId', input.ruleId],
    ['ruleVersion', input.ruleVersion],
  ];
  for (const [field, value] of required) {
    if (!value?.trim()) {
      throw new PersistenceDataQualityError(`Missing fingerprint input: ${field}`);
    }
  }
}

export function computeRecommendationFingerprint(input: RecommendationFingerprintInput): string {
  assertFingerprintInput(input);
  const payload = {
    version: FINGERPRINT_VERSION,
    service: input.service,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    region: input.region,
    category: input.category,
    recommendedAction: input.recommendedAction,
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion,
    currentInstanceType: input.currentInstanceType ?? null,
    candidateInstanceType: input.candidateInstanceType ?? null,
    observedValues: input.observedValues ?? {},
    thresholds: input.thresholds ?? {},
  };
  return createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex');
}
