/**
 * Platform-wide constants. Avoid magic strings across engines, plugins, and API.
 */

export const PLUGIN_NAMES = {
  EC2: 'ec2',
} as const;

export type PluginName = (typeof PLUGIN_NAMES)[keyof typeof PLUGIN_NAMES];

export const PROVIDER_NAMES = {
  MOCK: 'mock',
  AWS: 'aws',
} as const;

export type ProviderName = (typeof PROVIDER_NAMES)[keyof typeof PROVIDER_NAMES];

export const WORKFLOW_STATES = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[keyof typeof WORKFLOW_STATES];

export const WORKFLOW_STAGES = {
  EVIDENCE: 'evidence',
  QUALIFICATION: 'qualification',
  GOVERNANCE: 'governance',
  FINANCIAL: 'financial',
  CONFIDENCE: 'confidence',
  RECOMMENDATION: 'recommendation',
  EXECUTION: 'execution',
  VERIFICATION: 'verification',
  LEARNING: 'learning',
} as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[keyof typeof WORKFLOW_STAGES];

/** Explicit execution states tracked by the Workflow Orchestrator (Sprint 7). */
export const WORKFLOW_EXECUTION_STATES = {
  INITIALIZED: 'initialized',
  EVIDENCE_COLLECTION: 'evidence_collection',
  GOVERNANCE_EVALUATION: 'governance_evaluation',
  FINANCIAL_ANALYSIS: 'financial_analysis',
  CONFIDENCE_ANALYSIS: 'confidence_analysis',
  RECOMMENDATION_GENERATION: 'recommendation_generation',
  EXECUTION: 'execution',
  VERIFICATION: 'verification',
  OUTCOME_STORAGE: 'outcome_storage',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type WorkflowExecutionState =
  (typeof WORKFLOW_EXECUTION_STATES)[keyof typeof WORKFLOW_EXECUTION_STATES];

/** Maximum retry attempts for recoverable workflow stage failures. */
export const WORKFLOW_MAX_RETRIES = 3;

export const EVIDENCE_STATUS = {
  COMPLETE: 'complete',
  INCOMPLETE: 'incomplete',
  PENDING: 'pending',
} as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUS)[keyof typeof EVIDENCE_STATUS];

export const GOVERNANCE_STATUS = {
  APPROVED: 'approved',
  NEEDS_APPROVAL: 'needs_approval',
  REJECTED: 'rejected',
} as const;

export type GovernanceStatus = (typeof GOVERNANCE_STATUS)[keyof typeof GOVERNANCE_STATUS];

export const READINESS_STATUS = {
  READY: 'READY',
  PARTIALLY_READY: 'PARTIALLY_READY',
  NOT_READY: 'NOT_READY',
} as const;

export type ReadinessStatus = (typeof READINESS_STATUS)[keyof typeof READINESS_STATUS];

export const POLICY_STATUS = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  WARN: 'WARN',
} as const;

export type PolicyStatus = (typeof POLICY_STATUS)[keyof typeof POLICY_STATUS];

export const POLICY_SEVERITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

export type PolicySeverity = (typeof POLICY_SEVERITY)[keyof typeof POLICY_SEVERITY];

export const VERIFICATION_STATUS = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  PARTIAL: 'partial',
  FAILED: 'failed',
} as const;

export type VerificationStatusValue =
  (typeof VERIFICATION_STATUS)[keyof typeof VERIFICATION_STATUS];

export const EXECUTION_STATUS = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;

export type ExecutionStatus = (typeof EXECUTION_STATUS)[keyof typeof EXECUTION_STATUS];

export const API_VERSION = 'v1';

export const DEFAULT_REGION = 'us-east-1';

export const PLATFORM_MODE = {
  DEMO: 'demo',
  LIVE: 'live',
} as const;

export type PlatformMode = (typeof PLATFORM_MODE)[keyof typeof PLATFORM_MODE];

export const FINANCIAL_STATUS = {
  ESTIMATED: 'ESTIMATED',
  UNAVAILABLE: 'UNAVAILABLE',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
} as const;

export type FinancialStatus = (typeof FINANCIAL_STATUS)[keyof typeof FINANCIAL_STATUS];

export const CONFIDENCE_STATUS = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;

export type ConfidenceStatus = (typeof CONFIDENCE_STATUS)[keyof typeof CONFIDENCE_STATUS];

export const RECOMMENDATION_STATUS = {
  RECOMMENDED: 'RECOMMENDED',
  NOT_RECOMMENDED: 'NOT_RECOMMENDED',
  DEFERRED: 'DEFERRED',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
} as const;

export type RecommendationStatus =
  (typeof RECOMMENDATION_STATUS)[keyof typeof RECOMMENDATION_STATUS];
