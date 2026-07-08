/**
 * Shared domain models exchanged across engines, plugins, and the orchestrator.
 * Contains data contracts only — no business logic.
 */

import type {
  EvidenceStatus,
  FinancialStatus,
  GovernanceStatus,
  PluginName,
  PolicySeverity,
  PolicyStatus,
  ProviderName,
  ReadinessStatus,
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

/** Individual readiness factor contributing to the overall score. */
export interface ReadinessFactor {
  name: string;
  score: number;
  weight: number;
  met: boolean;
  detail: string;
}

/** Readiness scoring output — can this candidate proceed to optimization evaluation? */
export interface ReadinessResult {
  score: number;
  status: ReadinessStatus;
  factors: ReadinessFactor[];
}

/** Result of evaluating a single governance policy rule. */
export interface PolicyResult {
  name: string;
  status: PolicyStatus;
  reason: string;
  severity: PolicySeverity;
  suggestedAction?: string;
}

/** Confidence scoring output — should this recommendation be trusted? */
export interface ConfidenceResult {
  score: number;
  level: 'low' | 'medium' | 'high';
  factors: string[];
}

/** Governance engine decision output. */
export interface GovernanceResult {
  /** Readiness gate — whether evidence is sufficient for downstream evaluation. */
  status: ReadinessStatus;
  /** Policy decision — whether optimization is permitted under governance rules. */
  decision: GovernanceStatus;
  readinessScore: number;
  /** Detailed readiness breakdown with weighted factors. */
  readiness: ReadinessResult;
  reason: string;
  approver?: string;
  policies: PolicyResult[];
}

/** Cost estimate for a single instance configuration. */
export interface CostEstimate {
  instanceType: string;
  hourlyRate: number;
  monthlyCost: number;
  currency: string;
}

/** Savings estimate derived from current vs projected costs. */
export interface SavingsEstimate {
  monthlySavings: number;
  annualSavings: number;
  percentageReduction: number;
}

/** Pricing summary comparing current and projected instance costs. */
export interface PricingSummary {
  region: string;
  current: CostEstimate;
  projected: CostEstimate;
}

/** Complete financial summary with pricing, savings, and status. */
export interface FinancialSummary {
  pricing: PricingSummary;
  savings: SavingsEstimate;
  roi: number;
  status: FinancialStatus;
}

/** Financial impact estimation output. */
export interface FinancialImpact {
  currentMonthlyCost: number;
  projectedMonthlyCost: number;
  monthlySavings: number;
  annualSavings: number;
  percentageReduction: number;
  status: FinancialStatus;
  currency: string;
  summary: FinancialSummary;
  /** @deprecated Use currentMonthlyCost — retained for demo workflow compatibility. */
  currentCost: number;
  /** @deprecated Use projectedMonthlyCost — retained for demo workflow compatibility. */
  recommendedCost: number;
  roi: number;
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
  providerData: ProviderEvidenceBundle;
}

/** Evidence engine output. */
export interface EvidenceResult {
  package: EvidencePackage;
  status: EvidenceStatus;
}

/** Governance engine input — evaluates evidence quality and applies governance policies. */
export interface GovernanceRequest {
  context: OptimizationContext;
  candidate: Candidate;
  evidence: StandardizedEvidence;
  evidenceStatus: EvidenceStatus;
  validation: EvidenceValidationResult;
  recommendation?: Recommendation;
}

/** Sprint 3 governance workflow response returned by the orchestrator. */
export interface GovernanceWorkflowResult {
  workflowId: string;
  candidate: Candidate;
  evidence: StandardizedEvidence;
  evidenceStatus: EvidenceStatus;
  validation: EvidenceValidationResult;
  governance: GovernanceResult;
  readiness: ReadinessResult;
  completedAt: string;
}

/** Financial engine input — estimates impact from evidence and provider pricing hints. */
export interface FinancialRequest {
  context: OptimizationContext;
  candidate: Candidate;
  evidence: StandardizedEvidence;
  governance: GovernanceResult;
}

/** Sprint 4 financial workflow response returned by the orchestrator. */
export interface FinancialWorkflowResult {
  workflowId: string;
  candidate: Candidate;
  evidence: StandardizedEvidence;
  governance: GovernanceResult;
  readiness: ReadinessResult;
  financialImpact: FinancialImpact;
  completedAt: string;
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
export interface UtilizationHistoryPoint {
  timestamp: string;
  cpuUtilization: number;
  memoryUtilization: number;
  networkUtilization?: number;
}

/** Provider-normalized metrics response. */
export interface ProviderMetrics {
  resourceId: string;
  cpuUtilization: number[];
  memoryUtilization: number[];
  networkUtilization?: number[];
  period: string;
  datapoints: number;
  utilizationHistory?: UtilizationHistoryPoint[];
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
  source?: string;
  finding?: string;
  estimatedMonthlySavings?: number;
}

/** Raw provider data assembled by a plugin before evidence normalization. */
export interface ProviderEvidenceBundle {
  instance: ProviderInstance;
  metrics: ProviderMetrics;
  pricing: ProviderPricing;
  recommendations: ProviderRecommendation[];
  tags: Record<string, string>;
}

/** Aggregated telemetry summary derived from metrics. */
export interface EvidenceTelemetry {
  cpuUtilization: number;
  memoryUtilization: number;
  networkUtilization?: number;
  observationWindowDays: number;
}

/** Normalized metrics block within standardized evidence. */
export interface EvidenceMetricsBlock {
  cpuUtilization: number[];
  memoryUtilization: number[];
  networkUtilization?: number[];
  period: string;
  datapoints: number;
  utilizationHistory: UtilizationHistoryPoint[];
}

/** Normalized pricing block within standardized evidence. */
export interface EvidencePricingBlock {
  instanceType: string;
  region: string;
  hourlyRate: number;
  monthlyRate: number;
  currency: string;
}

/** Normalized instance metadata within standardized evidence. */
export interface EvidenceInstanceBlock {
  instanceId: string;
  instanceType: string;
  state: string;
  region: string;
  launchTime: string;
}

/** Sprint 2 standardized evidence object returned by the Evidence Engine. */
export interface StandardizedEvidence {
  telemetry: EvidenceTelemetry;
  metrics: EvidenceMetricsBlock;
  pricing: EvidencePricingBlock;
  recommendations: ProviderRecommendation[];
  tags: Record<string, string>;
  instance: EvidenceInstanceBlock;
  collectedAt: string;
}

/** Validation outcome from the Evidence Engine. */
export interface EvidenceValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Complete evidence package returned by the evidence collection workflow. */
export interface EvidencePackage {
  workflowId: string;
  candidate: Candidate;
  evidence: StandardizedEvidence;
  status: EvidenceStatus;
  validation: EvidenceValidationResult;
}
