/**
 * Frontend types synchronized with backend API contracts.
 * Sprint 8: presentation layer only — no business logic.
 */

export interface ApiMetadata {
  requestId: string;
  timestamp: string;
  version: string;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  metadata: ApiMetadata;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    stage?: string;
  };
  metadata: ApiMetadata;
}

export interface OptimizationCandidate {
  resourceId: string;
  resourceType: string;
  region: string;
  accountId?: string;
  tags?: Record<string, string>;
}

export interface MockInstance {
  instanceId: string;
  instanceType: string;
  state: string;
  region: string;
  launchTime: string;
  tags: Record<string, string>;
}

export interface EvidenceTelemetry {
  cpuUtilization: number;
  memoryUtilization: number;
  networkUtilization?: number;
  observationWindowDays: number;
}

export interface EvidenceView {
  status?: string;
  validation?: { valid: boolean; errors: string[]; warnings: string[] };
  telemetry?: EvidenceTelemetry;
  instance?: {
    instanceId: string;
    instanceType: string;
    state: string;
    region: string;
  };
  pricing?: {
    instanceType: string;
    monthlyRate: number;
    hourlyRate: number;
    currency: string;
  };
  recommendations?: Array<{
    target: string;
    action: string;
    reason: string;
  }>;
  tags?: Record<string, string>;
  collectedAt?: string;
}

export interface PolicyResult {
  name: string;
  status: string;
  reason: string;
  severity: string;
}

export interface ReadinessFactor {
  name: string;
  score: number;
  weight: number;
  met: boolean;
  detail: string;
}

export interface GovernanceResult {
  status: string;
  decision: string;
  readinessScore: number;
  readiness?: {
    score: number;
    status: string;
    factors: ReadinessFactor[];
  };
  reason: string;
  approver?: string;
  policies: PolicyResult[];
}

export interface FinancialImpact {
  currentMonthlyCost: number;
  projectedMonthlyCost: number;
  monthlySavings: number;
  annualSavings: number;
  percentageReduction: number;
  status: string;
  currency: string;
}

export interface ConfidenceResult {
  score: number;
  status: string;
  reason: string;
  factors?: Array<{ name: string; score: number; detail: string }>;
}

export interface RecommendationDecision {
  status: string;
  summary: string;
  reason: string;
  detail?: {
    action: string;
    fromInstanceType: string;
    toInstanceType: string;
    description: string;
  };
  explanation?: {
    governance: string;
    financial: string;
    confidence: string;
  };
}

export interface ExecutionResult {
  executionId: string;
  status: string;
  success: boolean;
  message?: string;
  change?: {
    action: string;
    from: string;
    to: string;
  };
}

export interface VerificationResult {
  status: string;
  expectedSavings: number;
  actualSavings: number;
  verifiedSavings: number;
  variance: number;
  variancePercentage: number;
  stateMatched: boolean;
  confidenceScore?: number;
  message?: string;
}

export interface WorkflowFailure {
  failedStage: string;
  error: { engine: string; code: string; reason: string };
  timestamp: string;
}

export interface WorkflowRunResult {
  workflowId: string;
  status: string;
  executionState: string;
  durationMs: number;
  completedStages: string[];
  failedStages: string[];
  failure?: WorkflowFailure;
  candidate?: OptimizationCandidate;
  recommendation?: Pick<RecommendationDecision, 'status' | 'summary' | 'reason'>;
  financialImpact?: Pick<FinancialImpact, 'monthlySavings' | 'annualSavings' | 'status'>;
  verification?: Pick<VerificationResult, 'status'>;
}

export interface WorkflowDetail {
  metadata: {
    workflowId: string;
    plugin: string;
    createdAt: string;
    completedAt?: string;
    status: string;
    executionState: string;
    triggerSource: string;
    region: string;
  };
  status: string;
  executionState: string;
  currentStage?: string;
  completedStages: string[];
  failedStages: string[];
  failure?: WorkflowFailure;
  candidate?: OptimizationCandidate;
  evidence?: EvidenceView;
  governance?: GovernanceResult;
  financialImpact?: FinancialImpact;
  confidence?: ConfidenceResult;
  recommendation?: RecommendationDecision;
  execution?: ExecutionResult;
  verification?: VerificationResult;
  report?: { summary: string; status: string };
}

export interface WorkflowStatusSummary {
  workflowId: string;
  status: string;
  executionState: string;
  plugin: string;
  createdAt: string;
  completedAt?: string;
  currentStage?: string;
  completedStages: string[];
  failedStages: string[];
  failure?: WorkflowFailure;
}

export interface OverviewMetrics {
  totalCandidates: number;
  readyCandidates: number;
  potentialMonthlySavings: number;
  averageConfidence: number;
}

export type DashboardState = 'idle' | 'loading' | 'success' | 'error' | 'empty';

export interface RunWorkflowRequest {
  plugin?: string;
  mode?: 'full' | 'dry-run';
  resourceId?: string;
  region?: string;
}
