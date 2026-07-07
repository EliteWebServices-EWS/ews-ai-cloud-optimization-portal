/**
 * Shared domain models exchanged across engines, plugins, and the orchestrator.
 * Contains data contracts only — no business logic.
 */

import type {
  EvidenceStatus,
  GovernanceStatus,
  PluginName,
  ProviderName,
  VerificationStatusValue,
  WorkflowStage,
  WorkflowState,
} from '../constants';

/** A cloud resource eligible for optimization evaluation. */
export interface Candidate {
  resourceId: string;
  resourceType: string;
  region: string;
  accountId?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

/** Normalized evidence collected about a candidate resource. */
export interface Evidence {
  resourceId: string;
  resourceType: string;
  region: string;
  status: EvidenceStatus;
  cpuUtilization?: number;
  memoryUtilization?: number;
  networkUtilization?: number;
  monthlyCost?: number;
  instanceType?: string;
  recommendedInstanceType?: string;
  metrics?: Record<string, number[]>;
  tags?: Record<string, string>;
  collectedAt: string;
  metadata?: Record<string, unknown>;
}

/** Result of plugin qualification step. */
export interface QualificationResult {
  qualified: boolean;
  reason: string;
}

/** Readiness scoring output — can this recommendation be evaluated? */
export interface ReadinessResult {
  score: number;
  status: 'ready' | 'not_ready' | 'partial';
  factors: string[];
}

/** Confidence scoring output — should this recommendation be trusted? */
export interface ConfidenceResult {
  score: number;
  level: 'low' | 'medium' | 'high';
  factors: string[];
}

/** Governance engine decision output. */
export interface GovernanceResult {
  status: GovernanceStatus;
  reason: string;
  approver?: string;
  policiesEvaluated?: string[];
}

/** Financial impact estimation output. */
export interface FinancialImpact {
  currentCost: number;
  recommendedCost: number;
  monthlySavings: number;
  annualSavings: number;
  roi: number;
  currency: string;
}

/** Optimization recommendation produced by a plugin. */
export interface Recommendation {
  action: string;
  resourceId: string;
  resourceType: string;
  from?: string;
  to?: string;
  reason: string;
  region: string;
  metadata?: Record<string, unknown>;
}

/** Outcome of an executed optimization change. */
export interface ExecutionResult {
  resourceId: string;
  resourceType: string;
  action: string;
  success: boolean;
  executedAt: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** Verification engine output. */
export interface VerificationResult {
  status: VerificationStatusValue;
  expectedSavings: number;
  actualSavings: number;
  variance: number;
  confidenceScore?: number;
  message?: string;
}

/** Metadata describing a registered optimization plugin. */
export interface PluginMetadata {
  name: PluginName;
  version: string;
  description: string;
  resourceTypes: string[];
}

/** Context flowing through the optimization workflow. */
export interface OptimizationContext {
  workflowId: string;
  plugin: PluginName;
  provider: ProviderName;
  region: string;
  mode: 'demo' | 'live';
  startedAt: string;
  candidate?: Candidate;
}

/** Standard engine result wrapper. */
export interface Result<T> {
  success: boolean;
  data?: T;
  error?: EngineError;
}

/** Structured error returned by engines. */
export interface EngineError {
  engine: string;
  code: string;
  reason: string;
  recovery?: string;
}

/** Evidence engine input. */
export interface EvidenceRequest {
  context: OptimizationContext;
  candidate: Candidate;
}

/** Evidence engine output. */
export interface EvidenceResult {
  evidence: Evidence;
  status: EvidenceStatus;
}

/** Governance engine input. */
export interface GovernanceRequest {
  context: OptimizationContext;
  evidence: Evidence;
  recommendation: Recommendation;
}

/** Financial engine input. */
export interface FinancialRequest {
  context: OptimizationContext;
  evidence: Evidence;
  recommendation: Recommendation;
}

/** Verification engine input. */
export interface VerificationRequest {
  context: OptimizationContext;
  recommendation: Recommendation;
  financialImpact: FinancialImpact;
  executionResult?: ExecutionResult;
}

/** Combined workflow result returned by the orchestrator. */
export interface WorkflowResult {
  workflowId: string;
  status: WorkflowState;
  currentStage: WorkflowStage;
  context: OptimizationContext;
  candidate: Candidate;
  evidence: Evidence;
  qualification: QualificationResult;
  readiness: ReadinessResult;
  confidence: ConfidenceResult;
  recommendation: Recommendation;
  governance: GovernanceResult;
  financialImpact: FinancialImpact;
  verification: VerificationResult;
  completedAt: string;
}

/** Provider-normalized EC2 instance representation. */
export interface ProviderInstance {
  instanceId: string;
  instanceType: string;
  state: string;
  region: string;
  launchTime: string;
  tags: Record<string, string>;
}

/** Provider-normalized EBS volume representation. */
export interface ProviderVolume {
  volumeId: string;
  sizeGb: number;
  volumeType: string;
  state: string;
  region: string;
  attachedTo?: string;
}

/** Provider-normalized metrics response. */
export interface ProviderMetrics {
  resourceId: string;
  cpuUtilization: number[];
  memoryUtilization: number[];
  period: string;
  datapoints: number;
}

/** Provider-normalized pricing response. */
export interface ProviderPricing {
  instanceType: string;
  region: string;
  hourlyRate: number;
  monthlyRate: number;
  currency: string;
}

/** Provider-normalized optimization hint from external sources. */
export interface ProviderRecommendation {
  resourceId: string;
  resourceType: string;
  action: string;
  target: string;
  reason: string;
}
