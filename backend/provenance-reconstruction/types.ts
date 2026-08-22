import type { ActionLogEventType, ActionLogRecord, ActionLogSourceStage } from '../action-log/types';
import type { ProvenanceReasonCode } from './reason-codes';

export const PROVENANCE_COMPLETENESS = [
  'COMPLETE',
  'PARTIAL',
  'INCOMPLETE',
] as const;

export type ProvenanceCompleteness = (typeof PROVENANCE_COMPLETENESS)[number];

export const PROVENANCE_SOURCE_AVAILABILITY = [
  'AVAILABLE',
  'UNAVAILABLE',
  'NOT_RESOLVED',
  'ACTIONLOG_AUTHORITATIVE',
] as const;

export type ProvenanceSourceAvailability =
  (typeof PROVENANCE_SOURCE_AVAILABILITY)[number];

export interface ProvenanceTrustedScope {
  tenantId: string;
  accountId: string;
}

export interface ProvenanceSourceReference {
  sourceStage: ActionLogSourceStage;
  eventType: ActionLogEventType;
  sourceRecordId: string;
  sourceRecordVersion?: string;
  tenantId: string;
  accountId?: string;
  occurredAt: string;
  logicalEventId: string;
  availability: ProvenanceSourceAvailability;
  modelId?: string;
}

export interface MlProvenanceSummary {
  evaluationId: string;
  modelId?: string;
  modelVersion?: string;
  featureSchemaVersion?: string;
  eligibilityPolicyVersion?: string;
  eligibility?: string;
  outcome?: string;
  fallback?: string;
  reasonCodes: readonly string[];
  evaluatedAt?: string;
  inferredAt?: string;
}

export type SourceVerificationMode =
  | 'source_verified'
  | 'actionlog_lifecycle_diagnostic';

export interface ReconstructDecisionProvenanceInput extends ProvenanceTrustedScope {
  decisionId?: string;
  correlationId?: string;
  /**
   * Default `source_verified` — required reference-only stages must be
   * AVAILABLE or ActionLog-authoritative before authoritative COMPLETE.
   * `actionlog_lifecycle_diagnostic` returns the lifecycle chain only.
   */
  sourceVerificationMode?: SourceVerificationMode;
}

export interface DecisionProvenanceReconstructionResult {
  tenantId: string;
  accountId: string;
  decisionId: string | null;
  correlationId: string;
  completeness: ProvenanceCompleteness;
  reasonCodes: readonly ProvenanceReasonCode[];
  orderedEvents: readonly ActionLogRecord[];
  sourceReferences: readonly ProvenanceSourceReference[];
  stagesPresent: readonly ActionLogSourceStage[];
  stagesMissing: readonly string[];
  policyVersions: Readonly<Record<string, string | undefined>>;
  mlProvenance: MlProvenanceSummary | null;
  sourceVerificationMode: SourceVerificationMode;
  reconstructedAt: string;
}
