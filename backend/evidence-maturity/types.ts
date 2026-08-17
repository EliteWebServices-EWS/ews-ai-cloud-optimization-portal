import type { Ec2PerformanceDataCompleteness } from '../cloud-intelligence/ec2-cost/ec2-cost-models';
import type {
  EvidenceMaturity,
  EvidenceObservationRecord,
  PersistenceState,
} from '../persistence-intelligence/types';
import type { EvidenceMaturityReasonCode } from './reason-codes';
import type { EvidenceMaturityConfig } from './maturity-config';

export type TelemetryApplicability = 'REQUIRED' | 'NOT_APPLICABLE';

export interface MaturityScoreFactor {
  factor: string;
  weight: number;
  earned: number;
  satisfied: boolean;
  detail: string;
}

export interface StableEpochResult {
  observations: EvidenceObservationRecord[];
  observationCount: number;
  stableEpochHours: number;
  earliestObservationTimestamp: string;
  latestObservationTimestamp: string;
}

export interface EvidenceMaturityEvaluationInput {
  sourceObservation: EvidenceObservationRecord;
  findingHistory: EvidenceObservationRecord[];
  telemetryApplicability: TelemetryApplicability;
  dataCompleteness: Ec2PerformanceDataCompleteness | 'NOT_APPLICABLE';
  evaluatedAt: string;
  config?: EvidenceMaturityConfig;
}

export interface EvidenceMaturityAssessment {
  maturity: EvidenceMaturity;
  score: number;
  reasonCodes: EvidenceMaturityReasonCode[];
  /**
   * Count of observations in the current stable epoch (same persisted fingerprint suffix).
   * Identical to stableEpochObservationCount in evidence-maturity-v1.
   */
  observationCount: number;
  /** Explicit stable-epoch count; always equals observationCount in v1. */
  stableEpochObservationCount: number;
  /** Sprint 1 last-gap hours to the relevant previous observation (immutable Sprint 1 semantics). */
  persistenceHours: number | null;
  /** Hours from earliest to latest observation timestamp within the current stable epoch. */
  stableEpochHours: number;
  evidenceCompleteness: Ec2PerformanceDataCompleteness | 'NOT_APPLICABLE';
  telemetryApplicability: TelemetryApplicability;
  evaluatedAt: string;
  /** Immutable source observation timestamp; drives physical SK and list chronology. */
  sourceObservationTimestamp: string;
  modelVersion: string;
  sourceObservationId: string;
  sourceLogicalObservationId: string;
  sourcePersistenceState: PersistenceState;
  tenantId: string;
  accountId: string;
  region: string;
  resourceId: string;
  findingKey: string;
  recommendationFingerprint: string;
  ruleId: string;
  ruleVersion: string;
  category: string;
  analysisRunId: string;
  stableEpochObservationIds: string[];
  stableEpochLogicalObservationIds: string[];
  scoreFactors: MaturityScoreFactor[];
}

export interface EvidenceMaturityAssessmentRecord extends EvidenceMaturityAssessment {
  assessmentId: string;
  persistedAt: string;
}

export interface RecordEvidenceMaturityAssessmentInput {
  assessment: EvidenceMaturityAssessment;
}

export interface RecordEvidenceMaturityAssessmentResult {
  record: EvidenceMaturityAssessmentRecord;
  created: boolean;
}
