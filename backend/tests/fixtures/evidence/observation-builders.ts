import { buildEc2CostFindingKey } from '../../../database/cloud-resources/ec2-cost-keys';
import { buildLogicalObservationId } from '../../../persistence-intelligence/observation-ordering';
import { PERSISTENCE_REASON } from '../../../persistence-intelligence/reason-codes';
import {
  buildRecommendationFingerprintInputFromEc2Cost,
  computeRecommendationFingerprint,
} from '../../../persistence-intelligence/recommendation-fingerprint';
import type {
  EvidenceObservationRecord,
  RecordEvidenceObservationInput,
  RecommendationFingerprintInput,
} from '../../../persistence-intelligence/types';
import {
  EC2_CATEGORY_UNDERUTILIZED,
  EC2_RULE_ID_UNDERUTILIZED,
  EC2_RULE_VERSION,
  FIXED_COLLECTION_TS_1,
  FIXED_OBSERVATION_TS_1,
  buildEvidenceIdentity,
  type EvidenceIdentity,
} from './identities';

export interface BuildObservationInputOptions extends Partial<RecordEvidenceObservationInput> {
  identity?: Partial<EvidenceIdentity>;
  fingerprintOverrides?: Partial<RecommendationFingerprintInput>;
}

export function buildEc2FindingKeyForIdentity(
  identity: EvidenceIdentity,
  category = EC2_CATEGORY_UNDERUTILIZED,
  ruleVersion = EC2_RULE_VERSION,
): string {
  return buildEc2CostFindingKey({
    tenantId: identity.tenantId,
    accountId: identity.accountId,
    region: identity.region,
    resourceId: identity.resourceId,
    category,
    ruleVersion,
  });
}

/**
 * DynamoDB sort-key safe finding key (no `#` separators).
 * Used for DynamoDbEvidenceObservationRepository adapter tests only.
 * EC2 production finding keys from buildEc2CostFindingKey() currently contain `#`
 * and are rejected by evidenceObservationSortKey() — see sprint-1-evidence-fixtures-qa.md.
 */
export function buildDynamoSafeFindingKey(
  identity: EvidenceIdentity,
  category = EC2_CATEGORY_UNDERUTILIZED,
  ruleVersion = EC2_RULE_VERSION,
): string {
  return [
    identity.tenantId,
    identity.accountId,
    identity.region,
    identity.resourceId,
    category,
    ruleVersion,
  ].join('-');
}

export function buildDefaultFingerprintInput(
  identity: EvidenceIdentity,
  overrides: Partial<RecommendationFingerprintInput> = {},
): RecommendationFingerprintInput {
  const { service: _service, ...rest } = overrides;
  return buildRecommendationFingerprintInputFromEc2Cost({
    service: 'ec2',
    resourceType: 'INSTANCE',
    resourceId: identity.resourceId,
    region: identity.region,
    category: EC2_CATEGORY_UNDERUTILIZED,
    recommendedAction: 'Rightsize to t3.medium',
    ruleId: EC2_RULE_ID_UNDERUTILIZED,
    ruleVersion: EC2_RULE_VERSION,
    observedValues: { avgCpu: 4.2 },
    thresholds: { maxCpu: 20 },
    ...rest,
  });
}

/** Builds a fresh RecordEvidenceObservationInput using production key/fingerprint helpers. */
export function buildRecordEvidenceObservationInput(
  overrides: BuildObservationInputOptions = {},
): RecordEvidenceObservationInput {
  const identity = buildEvidenceIdentity(overrides.identity);
  const findingKey =
    overrides.findingKey ??
    buildEc2FindingKeyForIdentity(identity, overrides.category, overrides.ruleVersion);
  const fingerprintInput =
    overrides.fingerprintInput ??
    buildDefaultFingerprintInput(identity, overrides.fingerprintOverrides);

  const base: RecordEvidenceObservationInput = {
    tenantId: identity.tenantId,
    accountId: identity.accountId,
    region: identity.region,
    service: 'ec2',
    resourceType: 'INSTANCE',
    resourceId: identity.resourceId,
    findingKey,
    recommendationId: 'rec-1',
    recommendedAction: 'Rightsize to t3.medium',
    category: EC2_CATEGORY_UNDERUTILIZED,
    ruleId: EC2_RULE_ID_UNDERUTILIZED,
    ruleVersion: EC2_RULE_VERSION,
    analysisRunId: 'run-1',
    recommendationVersion: 1,
    fingerprintInput,
    observationTimestamp: FIXED_OBSERVATION_TS_1,
    collectionTimestamp: FIXED_COLLECTION_TS_1,
    provenance: 'ec2-cost-analysis',
  };

  const { identity: _identity, fingerprintOverrides: _fp, ...rest } = overrides;
  return structuredClone({ ...base, ...rest });
}

/** Synthetic prior record for unit-level assessPersistence tests. */
export function buildEvidenceObservationRecord(
  input: RecordEvidenceObservationInput,
  assessmentState: EvidenceObservationRecord['assessment']['state'],
  observationTimestamp: string,
  observationIdSuffix = 'log-1',
): EvidenceObservationRecord {
  const fingerprint = computeRecommendationFingerprint(input.fingerprintInput);
  const logicalObservationId = buildLogicalObservationId({
    tenantId: input.tenantId,
    accountId: input.accountId,
    findingKey: input.findingKey,
    analysisRunId: input.analysisRunId,
    observationTimestamp,
  });

  return {
    observationId: `obs-${observationIdSuffix}`,
    logicalObservationId,
    tenantId: input.tenantId,
    accountId: input.accountId,
    region: input.region,
    service: input.service,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    findingKey: input.findingKey,
    recommendationId: input.recommendationId,
    recommendationFingerprint: fingerprint,
    recommendedAction: input.recommendedAction,
    category: input.category,
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion,
    analysisRunId: input.analysisRunId,
    provenance: input.provenance,
    observationTimestamp,
    collectionTimestamp: input.collectionTimestamp,
    persistedAt: input.collectionTimestamp,
    assessment: {
      state: assessmentState,
      recommendationFingerprint: fingerprint,
      persistenceHours: null,
      reasonCodes: [PERSISTENCE_REASON.FIRST_OBSERVATION],
      logicalObservationId,
    },
    version: 1,
  };
}

/** Legacy alias used by persistence-intelligence unit tests before refactor. */
export const buildBaseObservationInput = buildRecordEvidenceObservationInput;
export const observationFromInput = buildEvidenceObservationRecord;
