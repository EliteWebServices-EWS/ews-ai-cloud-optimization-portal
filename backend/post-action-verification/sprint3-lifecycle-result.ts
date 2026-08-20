import type { MLDecision } from '../ml-decision/types';
import type { ActionPolicyResult } from '../action-policy/types';
import type { Sprint2DecisionReadinessResult } from '../decision-readiness/types';
import type { PostActionVerificationAssessment } from './types';

export interface Sprint3LifecycleResult {
  recommendation: string;
  persistence: string;
  persistenceDurationHours: number;
  maturity: string;
  governance: string;
  confidence: string;
  decisionReadiness: string;
  ml: {
    eligibility: 'ML_ELIGIBLE' | 'ML_INELIGIBLE';
    outcome: MLDecision['outcome'];
    fallback: MLDecision['fallback'];
  };
  approval: {
    required: boolean;
    status: 'REQUIRED' | 'APPROVED' | 'REJECTED' | 'MISSING';
  };
  execution: {
    mode: 'SIMULATED' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  };
  verification: PostActionVerificationAssessment;
  why: readonly string[];
  lifecycle: {
    correlationId: string;
    workflowId: string;
    executionId: string;
    decisionId: string;
    actionLogSourceRecordIds: readonly string[];
  };
}

export interface BuildSprint3LifecycleResultInput {
  recommendation: string;
  persistence: string;
  persistenceDurationHours: number;
  maturity: string;
  governance: string;
  confidenceLabel: string;
  confidenceScore: number;
  decisionReadiness: Sprint2DecisionReadinessResult;
  mlDecision: MLDecision;
  actionPolicy: ActionPolicyResult;
  approvalRequired: boolean;
  approvalStatus: Sprint3LifecycleResult['approval']['status'];
  executionMode: Sprint3LifecycleResult['execution']['mode'];
  verification: PostActionVerificationAssessment;
  reasonCodes: readonly string[];
  correlationId: string;
  workflowId: string;
  executionId: string;
  decisionId: string;
  actionLogSourceRecordIds: readonly string[];
}

export function buildSprint3LifecycleResult(
  input: BuildSprint3LifecycleResultInput,
): Sprint3LifecycleResult {
  return {
    recommendation: input.recommendation,
    persistence: input.persistence,
    persistenceDurationHours: input.persistenceDurationHours,
    maturity: input.maturity,
    governance: input.governance,
    confidence: `${input.confidenceLabel} — ${input.confidenceScore}`,
    decisionReadiness: input.decisionReadiness.readiness,
    ml: {
      eligibility: input.mlDecision.eligibility === 'ML_ELIGIBLE' ? 'ML_ELIGIBLE' : 'ML_INELIGIBLE',
      outcome: input.mlDecision.outcome,
      fallback: input.mlDecision.fallback,
    },
    approval: {
      required: input.approvalRequired,
      status: input.approvalStatus,
    },
    execution: {
      mode: input.executionMode,
    },
    verification: input.verification,
    why: [...input.reasonCodes],
    lifecycle: {
      correlationId: input.correlationId,
      workflowId: input.workflowId,
      executionId: input.executionId,
      decisionId: input.decisionId,
      actionLogSourceRecordIds: [...input.actionLogSourceRecordIds],
    },
  };
}
