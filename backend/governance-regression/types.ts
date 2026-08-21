import type { MlDecisionSummary } from '../action-policy/ml-decision-summary';
import type {
  ActionPolicyApprovalRequirement,
  ActionPolicyExecutionEligibility,
} from '../action-policy/types';
import type { DecisionReadinessState } from '../decision-readiness/types';
import type { GovernanceConvergenceState } from '../governance-convergence/types';
import type { EvidenceMaturity } from '../persistence-intelligence/types';
import type { ExecutionApprovalStatus } from '../repositories/models/execution-persistence-models';
import type { PostActionVerificationOutcome } from '../post-action-verification/types';
import type { ConfidenceResult, VerificationResult } from '../shared/types';
import type { PolicyStatus } from '../shared/constants/index';
import type {
  GovernanceContradictionCode,
  GovernanceSafetyReasonCode,
} from './reason-codes';

export interface GovernanceSafetyTrustedScope {
  tenantId: string;
  accountId: string;
  /** False when caller scope does not match authoritative record scope. */
  scopeVerified: boolean;
}

export interface GovernanceSafetyIntelligenceSlice {
  maturity?: EvidenceMaturity | null;
  readiness: DecisionReadinessState;
  governanceConvergenceState?: GovernanceConvergenceState | null;
  governanceContextAvailable?: boolean | null;
  legacyGovernancePolicyStatus?: PolicyStatus | null;
  confidenceStatus?: ConfidenceResult['status'] | null;
  pricingEvidenceAvailable?: boolean | null;
  telemetryEvidenceAvailable?: boolean | null;
}

export interface GovernanceSafetyPolicySlice {
  actionPolicyApproval?: ActionPolicyApprovalRequirement | null;
  actionPolicyExecutionEligibility?: ActionPolicyExecutionEligibility | null;
  actionPolicyReadiness?: DecisionReadinessState | null;
  mlDecisionSummary?: MlDecisionSummary | null;
  approvalRequired?: boolean | null;
  approvalStatus?: ExecutionApprovalStatus | null;
  approvalActorAuthorized?: boolean | null;
  approvalMfaVerified?: boolean | null;
  approvalStale?: boolean | null;
  claimsMlAuthority?: boolean | null;
  claimsApprovedFromConfidence?: boolean | null;
}

export interface GovernanceSafetyExecutionSlice {
  executionAttempted?: boolean | null;
  executionApiSucceeded?: boolean | null;
  optimizationVerified?: boolean | null;
}

export interface GovernanceSafetyVerificationSlice {
  postActionOutcome?: PostActionVerificationOutcome | null;
  legacyVerificationStatus?: VerificationResult['status'] | null;
  verificationEvidenceSufficient?: boolean | null;
}

export interface GovernanceSafetyRollbackSlice {
  rollbackCandidate?: boolean | null;
  rollbackAuthorized?: boolean | null;
  rollbackInvokedByVerification?: boolean | null;
  rollbackActorAuthorized?: boolean | null;
  rollbackMfaVerified?: boolean | null;
  rollbackAttributionPresent?: boolean | null;
  mlAuthorizedRollback?: boolean | null;
}

export interface GovernanceSafetyQualificationInput {
  evaluatedAt: string;
  scope: GovernanceSafetyTrustedScope;
  intelligence: GovernanceSafetyIntelligenceSlice;
  policy: GovernanceSafetyPolicySlice;
  execution?: GovernanceSafetyExecutionSlice;
  verification?: GovernanceSafetyVerificationSlice;
  rollback?: GovernanceSafetyRollbackSlice;
}

export interface GovernanceContradiction {
  code: GovernanceContradictionCode;
  message: string;
}

export type GovernanceSafetyQualificationResult =
  | {
      result: 'SAFE';
      reasonCodes: readonly GovernanceSafetyReasonCode[];
      evaluatedAt: string;
    }
  | {
      result: 'BLOCKED';
      reasonCodes: readonly GovernanceSafetyReasonCode[];
      contradictions: readonly GovernanceContradiction[];
      evaluatedAt: string;
    }
  | {
      result: 'INSUFFICIENT_EVIDENCE';
      reasonCodes: readonly GovernanceSafetyReasonCode[];
      evaluatedAt: string;
    };
