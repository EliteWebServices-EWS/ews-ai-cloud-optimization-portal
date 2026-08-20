import type { VerificationResult } from '../shared/types';
import type { PostActionVerificationReasonCode } from './reason-codes';

export const POST_ACTION_VERIFICATION_OUTCOMES = [
  'HEALTHY',
  'DEGRADED',
  'RESOLVED',
  'INSUFFICIENT_EVIDENCE',
  'ROLLBACK_CANDIDATE',
] as const;

export type PostActionVerificationOutcome =
  (typeof POST_ACTION_VERIFICATION_OUTCOMES)[number];

export interface PostActionTrustedScope {
  tenantId: string;
  accountId: string;
}

export interface PostActionEvidenceReference {
  sourceRecordId: string;
  sourceRecordVersion?: string | null;
}

export interface PostActionRecommendationStateEvidence {
  findingKey: string;
  recommendationId: string;
  /** Explicit post-action recommendation presence — null means unknown, never success. */
  present: boolean | null;
  sufficientEvidence: boolean;
}

export interface PostActionTelemetryEvidence {
  available: boolean | null;
  qualityAdequate: boolean | null;
  degraded: boolean | null;
}

/**
 * Sprint 3 enterprise post-action assessment composed from legacy comparator output.
 * HEALTHY != RESOLVED. ROLLBACK_CANDIDATE != rollback authorization.
 */
export interface PostActionVerificationAssessment {
  outcome: PostActionVerificationOutcome;
  reasonCodes: readonly PostActionVerificationReasonCode[];
  evaluatedAt: string;
  verificationPolicyVersion: string;
  assessmentId: string;
  executionReference: PostActionEvidenceReference;
  beforeEvidenceReference: PostActionEvidenceReference;
  afterEvidenceReference: PostActionEvidenceReference | null;
  recommendationStateReference: PostActionEvidenceReference;
  telemetryEvidenceReference: PostActionEvidenceReference;
  expectedImpactReference: PostActionEvidenceReference;
  observedImpactReference: PostActionEvidenceReference | null;
  legacyVerificationStatus: VerificationResult['status'];
  comparatorResult: VerificationResult;
}

export interface EvaluatePostActionVerificationInput {
  tenantId: string;
  accountId: string;
  evidenceContextScope: PostActionTrustedScope;
  evaluatedAt: string;
  assessmentId: string;
  executionReference: PostActionEvidenceReference;
  beforeEvidenceReference: PostActionEvidenceReference;
  afterEvidenceReference: PostActionEvidenceReference | null;
  recommendationStateReference: PostActionEvidenceReference;
  telemetryEvidenceReference: PostActionEvidenceReference;
  expectedImpactReference: PostActionEvidenceReference;
  observedImpactReference: PostActionEvidenceReference | null;
  recommendationState: PostActionRecommendationStateEvidence;
  telemetry: PostActionTelemetryEvidence;
  comparatorResult: VerificationResult;
  executionCompleted: boolean;
}
