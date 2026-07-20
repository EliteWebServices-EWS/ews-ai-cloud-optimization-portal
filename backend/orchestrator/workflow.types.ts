/**
 * Workflow Orchestrator types — context, results, metadata, and failure contracts.
 * Sprint 7: production-ready workflow engine data structures.
 */

import type {
  WorkflowExecutionState,
  WorkflowStage,
  WorkflowState,
  PluginName,
  EvidenceStatus,
} from '../shared/constants';
import type {
  Candidate,
  ConfidenceResult,
  EngineError,
  EvidencePackage,
  EvidenceValidationResult,
  ExecutionResult,
  FinancialImpact,
  GovernanceResult,
  LearningRecord,
  Observation,
  OptimizationContext,
  ReadinessResult,
  RecommendationDecision,
  StandardizedEvidence,
  VerificationReport,
  VerificationResult,
} from '../shared/types';

/** Source that initiated a workflow execution. */
export type WorkflowTriggerSource = 'api' | 'scheduler' | 'manual' | 'retry';

/** Record of a single failed retry attempt. */
export interface WorkflowFailureAttempt {
  stage: WorkflowStage;
  executionState: WorkflowExecutionState;
  error: EngineError;
  attemptNumber: number;
  timestamp: string;
}

/** Retry state tracked across workflow execution. */
export interface WorkflowRetryState {
  maxRetries: number;
  attemptCount: number;
  status: 'none' | 'retryable' | 'exhausted';
  failedAttempts: WorkflowFailureAttempt[];
}

/** Structured failure report when a workflow stage fails. */
export interface WorkflowFailure {
  workflowId: string;
  failedStage: WorkflowStage;
  executionState: WorkflowExecutionState;
  error: EngineError;
  timestamp: string;
}

/** Metadata describing workflow lifecycle for observability and tracking. */
export interface WorkflowMetadata {
  workflowId: string;
  tenantId: string;
  plugin: PluginName;
  createdAt: string;
  completedAt?: string;
  status: WorkflowState;
  executionState: WorkflowExecutionState;
  triggerSource: WorkflowTriggerSource;
  resourceId?: string;
  region: string;
}

/**
 * WorkflowContext — single source of truth during workflow execution.
 * Carries data and state between orchestrator pipeline stages.
 */
export interface WorkflowContext {
  workflowId: string;
  tenantId: string;
  plugin: PluginName;
  provider: OptimizationContext['provider'];
  region: string;
  mode: OptimizationContext['mode'];
  triggerSource: WorkflowTriggerSource;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;

  status: WorkflowState;
  executionState: WorkflowExecutionState;
  currentStage?: WorkflowStage;

  candidate?: Candidate;
  evidence?: StandardizedEvidence;
  evidenceStatus?: EvidenceStatus;
  validation?: EvidenceValidationResult;
  governance?: GovernanceResult;
  readiness?: ReadinessResult;
  financialImpact?: FinancialImpact;
  confidence?: ConfidenceResult;
  recommendation?: RecommendationDecision;
  execution?: ExecutionResult;
  observation?: Observation;
  verification?: VerificationResult;
  report?: VerificationReport;
  learningRecord?: LearningRecord;

  completedStages: WorkflowStage[];
  failedStages: WorkflowStage[];
  failure?: WorkflowFailure;
  retry: WorkflowRetryState;
}

/** Final workflow result returned after pipeline execution. */
export interface HardenedWorkflowResult {
  workflowId: string;
  status: WorkflowState;
  executionState: WorkflowExecutionState;
  durationMs: number;
  candidate?: Candidate;
  recommendation?: RecommendationDecision;
  financialImpact?: FinancialImpact;
  verification?: VerificationResult;
  report?: VerificationReport;
  learningRecord?: LearningRecord;
  completedStages: WorkflowStage[];
  failedStages: WorkflowStage[];
  failure?: WorkflowFailure;
  retry: WorkflowRetryState;
  completedAt?: string;
}

/** Snapshot stored for workflow lookup APIs. */
export interface WorkflowRecord {
  metadata: WorkflowMetadata;
  context: WorkflowContext;
  result?: HardenedWorkflowResult;
}

/** Request to start a hardened workflow execution. */
export interface ExecuteWorkflowRequest {
  tenantId: string;
  plugin: PluginName;
  resourceId?: string;
  region?: string;
  triggerSource?: WorkflowTriggerSource;
  mode?: 'full' | 'dry-run';
}

export type { EvidencePackage };
