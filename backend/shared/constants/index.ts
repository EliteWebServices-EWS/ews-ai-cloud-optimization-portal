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
  RECOMMENDATION: 'recommendation',
  VERIFICATION: 'verification',
  LEARNING: 'learning',
} as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[keyof typeof WORKFLOW_STAGES];

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

export const VERIFICATION_STATUS = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  PARTIAL: 'partial',
  FAILED: 'failed',
} as const;

export type VerificationStatusValue =
  (typeof VERIFICATION_STATUS)[keyof typeof VERIFICATION_STATUS];

export const API_VERSION = 'v1';

export const DEFAULT_REGION = 'us-east-1';

export const PLATFORM_MODE = {
  DEMO: 'demo',
  LIVE: 'live',
} as const;

export type PlatformMode = (typeof PLATFORM_MODE)[keyof typeof PLATFORM_MODE];
