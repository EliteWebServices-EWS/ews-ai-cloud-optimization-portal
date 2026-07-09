/**
 * Workflow Orchestrator configuration — stages, retries, and feature flags.
 * Sprint 7: avoid hardcoding workflow behavior.
 */

import {
  WORKFLOW_MAX_RETRIES,
  WORKFLOW_STAGES,
  type WorkflowStage,
} from '../shared/constants';

/** Feature flags controlling optional workflow behavior. */
export interface WorkflowFeatureFlags {
  /** When false, execution and verification stages are skipped (dry-run). */
  enableExecution: boolean;
  /** When false, learning store persistence is skipped. */
  enableLearning: boolean;
  /** When true, structured stage logs are emitted at debug level. */
  verboseLogging: boolean;
}

/** Timeout placeholders for future distributed execution (not enforced in MVP). */
export interface WorkflowTimeoutConfig {
  evidenceCollectionMs: number;
  governanceEvaluationMs: number;
  financialAnalysisMs: number;
  confidenceAnalysisMs: number;
  recommendationGenerationMs: number;
  executionMs: number;
  verificationMs: number;
  totalWorkflowMs: number;
}

/** Complete workflow orchestrator configuration. */
export interface WorkflowConfig {
  enabledStages: WorkflowStage[];
  maxRetries: number;
  timeouts: WorkflowTimeoutConfig;
  featureFlags: WorkflowFeatureFlags;
}

const ALL_STAGES: WorkflowStage[] = [
  WORKFLOW_STAGES.EVIDENCE,
  WORKFLOW_STAGES.GOVERNANCE,
  WORKFLOW_STAGES.FINANCIAL,
  WORKFLOW_STAGES.CONFIDENCE,
  WORKFLOW_STAGES.RECOMMENDATION,
  WORKFLOW_STAGES.EXECUTION,
  WORKFLOW_STAGES.VERIFICATION,
  WORKFLOW_STAGES.LEARNING,
];

/** Default production-ready workflow configuration for Demo Mode. */
export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = {
  enabledStages: ALL_STAGES,
  maxRetries: WORKFLOW_MAX_RETRIES,
  timeouts: {
    evidenceCollectionMs: 5_000,
    governanceEvaluationMs: 3_000,
    financialAnalysisMs: 3_000,
    confidenceAnalysisMs: 3_000,
    recommendationGenerationMs: 5_000,
    executionMs: 5_000,
    verificationMs: 5_000,
    totalWorkflowMs: 30_000,
  },
  featureFlags: {
    enableExecution: true,
    enableLearning: true,
    verboseLogging: false,
  },
};

/** Dry-run configuration — skips execution, verification, and learning. */
export const DRY_RUN_WORKFLOW_CONFIG: WorkflowConfig = {
  ...DEFAULT_WORKFLOW_CONFIG,
  enabledStages: [
    WORKFLOW_STAGES.EVIDENCE,
    WORKFLOW_STAGES.GOVERNANCE,
    WORKFLOW_STAGES.FINANCIAL,
    WORKFLOW_STAGES.CONFIDENCE,
    WORKFLOW_STAGES.RECOMMENDATION,
  ],
  featureFlags: {
    enableExecution: false,
    enableLearning: false,
    verboseLogging: false,
  },
};

/** Resolve workflow config from execution mode. */
export function resolveWorkflowConfig(mode?: 'full' | 'dry-run'): WorkflowConfig {
  return mode === 'dry-run' ? DRY_RUN_WORKFLOW_CONFIG : DEFAULT_WORKFLOW_CONFIG;
}

/** Check whether a stage is enabled in the given configuration. */
export function isStageEnabled(config: WorkflowConfig, stage: WorkflowStage): boolean {
  return config.enabledStages.includes(stage);
}
