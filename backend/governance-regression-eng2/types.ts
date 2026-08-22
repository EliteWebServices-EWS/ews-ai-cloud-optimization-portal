import type { EvidenceMaturity } from '../persistence-intelligence/types';
import type { GovernanceConvergenceState } from '../governance-convergence/types';
import type { DecisionReadinessState } from '../decision-readiness/types';
import type {
  ActionPolicyApprovalRequirement,
  ActionPolicyExecutionEligibility,
} from '../action-policy/types';
import type { MlOutcome } from '../ml-decision/types';
import type { PostActionVerificationOutcome } from '../post-action-verification/types';
import type { GovernanceRegressionReasonCode } from './reason-codes';

/**
 * Task 1 inventory. Every legacy-adjacent status this snapshot type accepts
 * is intentionally distinct from the Sprint 1-3 canonical unions above —
 * they are never merged into one enum. Callers must map their engine's
 * native output onto the correct slice; this module does not infer one
 * stage's state from another.
 */
export const LEGACY_GOVERNANCE_STATUSES = ['PASS', 'WARN', 'FAIL'] as const;
export type LegacyGovernanceStatus = (typeof LEGACY_GOVERNANCE_STATUSES)[number];

export interface GovernanceRegressionTenantScope {
  tenantId: string;
  accountId: string;
}

export interface EvidenceMaturitySlice {
  available: boolean;
  maturity: EvidenceMaturity | null;
}

export interface GovernanceSlice {
  contextAvailable: boolean;
  convergenceState: GovernanceConvergenceState | null;
  /** Present only when a legacy PASS/WARN/FAIL governance engine result feeds this decision. */
  legacyStatus?: LegacyGovernanceStatus | null;
}

export interface ConfidenceSlice {
  available: boolean;
  status: 'HIGH' | 'MEDIUM' | 'LOW' | null;
}

export interface DecisionReadinessSlice {
  available: boolean;
  readiness: DecisionReadinessState | null;
}

export interface MlDecisionSlice {
  present: boolean;
  outcome: MlOutcome | null;
  /**
   * Whether the action-policy evaluation that consumed this ML decision
   * recorded the non-authority reason code appropriate to the ML outcome.
   * This is read directly from ActionPolicyResult.reasonCodes by the
   * caller — it is not re-derived here.
   */
  actionPolicyRecordedNonAuthority: boolean;
}

export interface ActionPolicySlice {
  available: boolean;
  approval: ActionPolicyApprovalRequirement | null;
  executionEligibility: ActionPolicyExecutionEligibility | null;
  reasonCodes: readonly string[];
}

export type ApprovalSource = 'HUMAN_APPROVAL' | 'INFERRED_FROM_CONFIDENCE' | 'NOT_APPLICABLE';
export type ApprovalStatus = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'STALE';

export interface ApprovalSlice {
  available: boolean;
  approvalStatus: ApprovalStatus | null;
  approvalSource: ApprovalSource | null;
  approvalActorId: string | null;
  approvedAt: string | null;
}

export interface ExecutionSlice {
  attempted: boolean;
  apiSuccess: boolean | null;
  providerFailure: boolean;
}

export interface VerificationSlice {
  present: boolean;
  outcome: PostActionVerificationOutcome | null;
  /** True only if some caller incorrectly marked an INSUFFICIENT_EVIDENCE/ROLLBACK_CANDIDATE outcome as resolved. Used purely for contradiction detection. */
  incorrectlyMarkedResolved: boolean;
}

export interface RollbackSlice {
  candidateFlagged: boolean;
  evidenceSufficient: boolean | null;
  authorized: boolean;
  authorizedByActorId: string | null;
  authorizedAt: string | null;
  authorizedByMl: boolean;
  authorizedByVerificationDirectly: boolean;
}

/**
 * Full cross-stage decision snapshot the release-qualification gate
 * evaluates. Every slice is optional-by-presence (`available`/`present`
 * flags), never optional-by-omission — an absent stage must be explicit so
 * the gate can return INSUFFICIENT_EVIDENCE instead of silently treating a
 * missing input as passing.
 */
export interface DecisionLifecycleSnapshot {
  decisionId: string;
  correlationId: string;
  scope: GovernanceRegressionTenantScope;
  /** Tenant scope each individual sub-record actually carried, for cross-tenant contradiction detection. */
  observedRecordScopes: readonly GovernanceRegressionTenantScope[];
  evaluatedAt: string;
  evidenceMaturity: EvidenceMaturitySlice;
  governance: GovernanceSlice;
  confidence: ConfidenceSlice;
  decisionReadiness: DecisionReadinessSlice;
  mlDecision: MlDecisionSlice;
  actionPolicy: ActionPolicySlice;
  approval: ApprovalSlice;
  execution: ExecutionSlice;
  verification: VerificationSlice;
  rollback: RollbackSlice;
}

export interface InvariantViolation {
  code: GovernanceRegressionReasonCode;
  detail: string;
}

export interface Contradiction {
  code: GovernanceRegressionReasonCode;
  detail: string;
}

export const RELEASE_SAFETY_RESULTS = ['SAFE', 'BLOCKED', 'INSUFFICIENT_EVIDENCE'] as const;
export type ReleaseSafetyResult = (typeof RELEASE_SAFETY_RESULTS)[number];

export interface ReleaseSafetyGateResult {
  result: ReleaseSafetyResult;
  reasonCodes: GovernanceRegressionReasonCode[];
  invariantViolations: InvariantViolation[];
  contradictions: Contradiction[];
  missingEvidence: GovernanceRegressionReasonCode[];
  policyVersion: string;
  evaluatedAt: string;
  decisionId: string;
  correlationId: string;
}
