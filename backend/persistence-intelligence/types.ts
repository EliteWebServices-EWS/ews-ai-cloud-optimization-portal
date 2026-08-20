import type { PersistenceReasonCode } from './reason-codes';

export const PERSISTENCE_STATES = [
  'NEW',
  'STABLE',
  'CHANGED',
  'MISSING_PREVIOUS',
] as const;

export type PersistenceState = (typeof PERSISTENCE_STATES)[number];

/** Semantic contract — not a mandatory existing TypeScript interface name in other modules. */
export interface PersistenceAssessment {
  state: PersistenceState;
  recommendationFingerprint: string;
  persistenceHours: number | null;
  reasonCodes: PersistenceReasonCode[];
  comparedToObservationId?: string;
  logicalObservationId: string;
}

/** Semantic contract for evidence maturity sprint 2 — referenced for ordering only in Sprint 1. */
export type EvidenceMaturity = 'MATURE' | 'PARTIAL' | 'IMMATURE';

/** Semantic contract for ML decision sprint 3 — authoritative type lives in ml-decision. */
export type { MLDecision } from '../ml-decision/types';

/** Semantic contract for rollback assessment sprint 4 — not implemented in Sprint 1. */
export type RollbackAssessmentOutcome = 'MAINTAIN' | 'ROLLBACK' | 'INSUFFICIENT_EVIDENCE';

export interface RecommendationFingerprintInput {
  service: string;
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
}

export interface EvidenceObservationRecord {
  observationId: string;
  logicalObservationId: string;
  tenantId: string;
  accountId: string;
  region: string;
  service: string;
  resourceType: string;
  resourceId: string;
  findingKey: string;
  recommendationId: string;
  recommendationFingerprint: string;
  recommendedAction: string;
  category: string;
  ruleId: string;
  ruleVersion: string;
  analysisRunId: string;
  jobId?: string;
  correlationId?: string;
  provenance: string;
  observationTimestamp: string;
  collectionTimestamp: string;
  persistedAt: string;
  assessment: PersistenceAssessment;
  version: number;
}

export interface RecordEvidenceObservationInput {
  tenantId: string;
  accountId: string;
  region: string;
  service: string;
  resourceType: string;
  resourceId: string;
  findingKey: string;
  recommendationId: string;
  recommendedAction: string;
  category: string;
  ruleId: string;
  ruleVersion: string;
  analysisRunId: string;
  recommendationVersion: number;
  fingerprintInput: RecommendationFingerprintInput;
  observationTimestamp: string;
  collectionTimestamp: string;
  provenance: string;
  correlationId?: string;
  jobId?: string;
  expectedPriorHistory?: boolean;
}

export interface RecordEvidenceObservationResult {
  observation: EvidenceObservationRecord;
  assessment: PersistenceAssessment;
  created: boolean;
}
