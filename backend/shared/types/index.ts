/**
 * Shared domain models exchanged across engines, plugins, and the orchestrator.
 * Contains data contracts only — no business logic.
 */

import type {
  ConfidenceStatus,
  EvidenceStatus,
  ExecutionStatus,
  FinancialStatus,
  GovernanceStatus,
  PluginName,
  PolicySeverity,
  PolicyStatus,
  ProviderName,
  ReadinessStatus,
  RecommendationStatus,
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

/** Individual confidence factor contributing to the overall score. */
export interface ConfidenceFactor {
  name: string;
  score: number;
  weight: number;
  detail: string;
}

/** Confidence scoring output — should this optimization be trusted? */
export interface ConfidenceResult {
  score: number;
  status: ConfidenceStatus;
  reason: string;
  factors: ConfidenceFactor[];
  /** @deprecated Use status — retained for demo workflow compatibility. */
  level: 'low' | 'medium' | 'high';
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

/** Optimization action produced from evidence hints — not a final decision. */
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

/** Structured reason contributing to a recommendation decision. */
export interface RecommendationReason {
  code: string;
  message: string;
}

/** Human-readable summary of the proposed optimization action. */
export interface RecommendationSummary {
  action: string;
  fromInstanceType: string;
  toInstanceType: string;
  description: string;
}

/** Business justification breakdown for a recommendation decision. */
export interface RecommendationExplanation {
  governance: string;
  financial: string;
  confidence: string;
}

/** Recommendation Engine decision output. */
export interface RecommendationDecision {
  status: RecommendationStatus;
  summary: string;
  reason: string;
  detail: RecommendationSummary;
  explanation: RecommendationExplanation;
  reasons: RecommendationReason[];
  action?: Recommendation;
}

/** Describes a resource change applied during mock execution. */
export interface ExecutionChange {
  action: string;
  from: string;
  to: string;
  resourceType: string;
}

/** Metadata describing how and where execution occurred. */
export interface ExecutionMetadata {
  workflowId: string;
  plugin: PluginName;
  region: string;
  simulated: boolean;
  recommendationStatus: RecommendationStatus;
}

/** Input to the mock execution simulator. */
export interface ExecutionRequest {
  context: OptimizationContext;
  candidate: Candidate;
  recommendation: RecommendationDecision;
}

/** Outcome of a simulated optimization execution. */
export interface ExecutionResult {
  executionId: string;
  status: ExecutionStatus;
  resourceId: string;
  resourceType: string;
  action: string;
  success: boolean;
  executedAt: string;
  change: ExecutionChange;
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
  metadata: ExecutionMetadata;
  message?: string;
  /** @deprecated Use previousState — retained for demo workflow compatibility. */
  beforeState?: Record<string, unknown>;
  /** @deprecated Use newState — retained for demo workflow compatibility. */
  afterState?: Record<string, unknown>;
}

/** Single observed metric collected after execution. */
export interface ObservationMetric {
  name: string;
  expected: number | string;
  observed: number | string;
  unit?: string;
  matched: boolean;
}

/** Post-execution observation collected by a plugin. */
export interface Observation {
  resourceId: string;
  resourceType: string;
  region: string;
  collectedAt: string;
  instanceType: string;
  previousInstanceType: string;
  monthlyCostBefore: number;
  monthlyCostAfter: number;
  observedMonthlySavings: number;
  metrics: ObservationMetric[];
  executionId: string;
  source: 'simulated';
}

/** Expected outcome used by the Verification Engine comparator. */
export interface VerificationExpectation {
  expectedMonthlySavings: number;
  expectedInstanceType: string;
  previousInstanceType: string;
  currency: string;
}

/** Detailed verification report for API and learning storage. */
export interface VerificationReport {
  workflowId: string;
  executionId: string;
  status: VerificationStatusValue;
  expected: VerificationExpectation;
  observation: Observation;
  result: VerificationResult;
  generatedAt: string;
  summary: string;
}

/** Verification engine output. */
export interface VerificationResult {
  status: VerificationStatusValue;
  expectedSavings: number;
  actualSavings: number;
  verifiedSavings: number;
  variance: number;
  variancePercentage: number;
  stateMatched: boolean;
  confidenceScore?: number;
  message?: string;
}

/** Plugin input for collecting post-execution observations. */
export interface PluginVerifyRequest {
  executionResult: ExecutionResult;
  recommendation: Recommendation;
  financialImpact: FinancialImpact;
}

/** Historical observation stored for future learning. */
export interface HistoricalObservation {
  workflowId: string;
  observation: Observation;
  recordedAt: string;
}

/** Complete optimization outcome for learning data capture. */
export interface OptimizationOutcome {
  workflowId: string;
  plugin: PluginName;
  candidate: Candidate;
  recommendation: RecommendationDecision;
  execution: ExecutionResult;
  observation: Observation;
  verification: VerificationResult;
  financialImpact: FinancialImpact;
  completedAt: string;
}

/** Learning record persisted after closed-loop verification. */
export interface LearningRecord {
  id: string;
  workflowId: string;
  plugin: PluginName;
  recommendation: RecommendationDecision;
  execution: ExecutionResult;
  observation: Observation;
  verification: VerificationResult;
  outcome: OptimizationOutcome;
  recordedAt: string;
}
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
  evidenceStatus: EvidenceStatus;
  validation: EvidenceValidationResult;
  governance: GovernanceResult;
  readiness: ReadinessResult;
  financialImpact: FinancialImpact;
  completedAt: string;
}

/** Confidence engine input — evaluates trust in optimization based on evidence quality. */
export interface ConfidenceRequest {
  context: OptimizationContext;
  candidate: Candidate;
  evidence: StandardizedEvidence;
  evidenceStatus: EvidenceStatus;
  validation: EvidenceValidationResult;
  governance: GovernanceResult;
  financialImpact: FinancialImpact;
}

/** Recommendation engine input — combines upstream engine outputs into a decision. */
export interface RecommendationRequest {
  context: OptimizationContext;
  candidate: Candidate;
  evidence: StandardizedEvidence;
  governance: GovernanceResult;
  financialImpact: FinancialImpact;
  confidence: ConfidenceResult;
}

/** Sprint 5 recommendation workflow response returned by the orchestrator. */
export interface RecommendationWorkflowResult {
  workflowId: string;
  candidate: Candidate;
  evidence: StandardizedEvidence;
  evidenceStatus: EvidenceStatus;
  validation: EvidenceValidationResult;
  governance: GovernanceResult;
  readiness: ReadinessResult;
  financialImpact: FinancialImpact;
  confidence: ConfidenceResult;
  recommendation: RecommendationDecision;
  completedAt: string;
}

/** Verification engine input. */
export interface VerificationRequest {
  context: OptimizationContext;
  recommendation: RecommendationDecision;
  financialImpact: FinancialImpact;
  executionResult: ExecutionResult;
  observation: Observation;
}

/** Sprint 6 verification workflow response returned by the orchestrator. */
export interface VerificationWorkflowResult {
  workflowId: string;
  candidate: Candidate;
  evidence: StandardizedEvidence;
  evidenceStatus: EvidenceStatus;
  validation: EvidenceValidationResult;
  governance: GovernanceResult;
  readiness: ReadinessResult;
  financialImpact: FinancialImpact;
  confidence: ConfidenceResult;
  recommendation: RecommendationDecision;
  execution: ExecutionResult;
  observation: Observation;
  verification: VerificationResult;
  report: VerificationReport;
  learningRecord?: LearningRecord;
  completedAt: string;
}

/** Sprint 6 complete closed-loop workflow response. */
export interface CompleteWorkflowResult extends VerificationWorkflowResult {
  status: WorkflowState;
  currentStage: WorkflowStage;
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
  execution?: ExecutionResult;
  observation?: Observation;
  verification: VerificationResult;
  completedAt: string;
  /** Sprint 5 recommendation decision when produced by the Recommendation Engine. */
  recommendationDecision?: RecommendationDecision;
  /** Sprint 6 verification report when produced by the closed-loop workflow. */
  verificationReport?: VerificationReport;
  /** Sprint 6 learning record when outcome is stored. */
  learningRecord?: LearningRecord;
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
