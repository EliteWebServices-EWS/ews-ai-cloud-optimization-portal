import type { DecisionReadinessState } from '../decision-readiness/types';
import type { ActionPolicyReasonCode } from './reason-codes';
import type { MlDecisionSummary } from './ml-decision-summary';

export const ACTION_MODES = ['SIMULATION', 'PRODUCTION'] as const;
export type ActionMode = (typeof ACTION_MODES)[number];

export const ACTION_POLICY_APPROVAL_REQUIREMENTS = [
  'REQUIRED',
  'NOT_REQUIRED',
  'BLOCKED',
] as const;
export type ActionPolicyApprovalRequirement =
  (typeof ACTION_POLICY_APPROVAL_REQUIREMENTS)[number];

export const ACTION_POLICY_EXECUTION_ELIGIBILITIES = [
  'ELIGIBLE',
  'NOT_ELIGIBLE',
] as const;
export type ActionPolicyExecutionEligibility =
  (typeof ACTION_POLICY_EXECUTION_ELIGIBILITIES)[number];

export interface ActionPolicyReadinessInput {
  readiness: DecisionReadinessState;
  reasonCodes: readonly string[];
  policyVersion: string;
  recommendedAction: string;
}

/**
 * Pure policy evaluation input. Authorization and MFA are enforced at the API seam.
 */
export interface EvaluateActionPolicyInput {
  evaluatedAt: string;
  decisionReadiness: ActionPolicyReadinessInput;
  mlDecisionSummary?: MlDecisionSummary;
  actionMode: ActionMode;
  infrastructureChanging: boolean;
}

export interface ActionPolicyResult {
  policyVersion: string;
  evaluatedAt: string;
  decisionReadiness: DecisionReadinessState;
  mlDecisionSummary?: MlDecisionSummary;
  proposedAction: string;
  actionMode: ActionMode;
  approval: ActionPolicyApprovalRequirement;
  executionEligibility: ActionPolicyExecutionEligibility;
  reasonCodes: ActionPolicyReasonCode[];
}

export interface ActionPolicyActorGateInput {
  authorized: boolean;
  mfaVerified: boolean;
  privilegedActionRequired: boolean;
}

export interface ActionPolicyActorGateResult {
  permitted: boolean;
  reasonCodes: ActionPolicyReasonCode[];
}
