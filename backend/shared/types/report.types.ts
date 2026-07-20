/**
 * Report models — structured optimization reports for API and frontend consumption.
 * Sprint 9: presentation and aggregation only; no business logic.
 */

import type {
  ConfidenceStatus,
  PluginName,
  RecommendationStatus,
  VerificationStatusValue,
  WorkflowState,
} from '../constants';
import type {
  Candidate,
  ConfidenceResult,
  EvidenceValidationResult,
  ExecutionResult,
  FinancialImpact,
  GovernanceResult,
  Observation,
  ReadinessResult,
  RecommendationDecision,
  StandardizedEvidence,
  VerificationReport,
  VerificationResult,
} from './index';

/** High-level optimization report status. */
export type ReportStatus = 'complete' | 'partial' | 'failed' | 'empty';

/** Supported export formats — file generation is future work. */
export type ReportExportFormat = 'pdf' | 'csv' | 'json';

/** Export-ready metadata describing available export targets. */
export interface ReportExportOption {
  format: ReportExportFormat;
  available: boolean;
  description: string;
}

/** Executive summary in plain business language. */
export interface ReportSummary {
  headline: string;
  opportunityCount: number;
  estimatedMonthlySavings: number;
  verifiedMonthlySavings: number;
  verifiedCount: number;
  currency: string;
  optimizationStatus: ReportStatus;
  executiveSummary: string;
  technicalSummary: string;
}

/** Per-resource summary within a report. */
export interface ResourceSummary {
  resourceId: string;
  resourceType: string;
  region: string;
  instanceType?: string;
  targetInstanceType?: string;
  environment?: string;
  evidenceStatus?: string;
  cpuUtilization?: number;
  memoryUtilization?: number;
}

/** Aggregated savings figures for a report. */
export interface SavingsSummary {
  currentMonthlyCost: number;
  projectedMonthlyCost: number;
  estimatedMonthlySavings: number;
  estimatedAnnualSavings: number;
  verifiedMonthlySavings: number;
  percentageReduction: number;
  currency: string;
  status: string;
}

/** Decision rationale summary for a single recommendation. */
export interface DecisionSummary {
  recommendationStatus: RecommendationStatus | string;
  confidenceScore: number;
  confidenceStatus: ConfidenceStatus | string;
  governanceDecision: string;
  governanceReason: string;
  summary: string;
  reason: string;
  action?: string;
  fromInstanceType?: string;
  toInstanceType?: string;
}

/** Verification outcome summary. */
export interface VerificationSummary {
  status: VerificationStatusValue | string;
  expectedSavings: number;
  actualSavings: number;
  verifiedSavings: number;
  variance: number;
  variancePercentage: number;
  stateMatched: boolean;
  message?: string;
}

/** Evidence summary block for technical reporting. */
export interface EvidenceSummary {
  status?: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  observationWindowDays?: number;
  collectedAt?: string;
}

/** Governance summary block for technical reporting. */
export interface GovernanceSummary {
  decision: string;
  readinessStatus: string;
  readinessScore: number;
  reason: string;
  approver?: string;
  policyCount: number;
  failedPolicies: number;
}

/** Recommendation entry within a report. */
export interface ReportRecommendationEntry {
  resourceId: string;
  resourceType: string;
  region: string;
  decision: DecisionSummary;
  financialImpact?: SavingsSummary;
  verification?: VerificationSummary;
}

/** Complete optimization report produced by the Reporting Engine. */
export interface OptimizationReport {
  reportId: string;
  tenantId: string;
  workflowId: string;
  plugin: PluginName;
  status: ReportStatus;
  workflowStatus: WorkflowState;
  createdAt: string;
  completedAt?: string;
  region: string;
  summary: ReportSummary;
  resources: ResourceSummary[];
  financialImpact: SavingsSummary;
  recommendations: ReportRecommendationEntry[];
  evidence?: EvidenceSummary;
  governance?: GovernanceSummary;
  verification?: VerificationSummary;
  exportOptions: ReportExportOption[];
}

/** Input for report generation — aggregated workflow outcome data. */
export interface ReportGenerationInput {
  tenantId: string;
  workflowId: string;
  plugin: PluginName;
  status: WorkflowState;
  region: string;
  completedAt?: string;
  candidate?: Candidate;
  evidence?: StandardizedEvidence;
  evidenceStatus?: string;
  validation?: EvidenceValidationResult;
  governance?: GovernanceResult;
  readiness?: ReadinessResult;
  financialImpact?: FinancialImpact;
  confidence?: ConfidenceResult;
  recommendation?: RecommendationDecision;
  execution?: ExecutionResult;
  observation?: Observation;
  verification?: VerificationResult;
  verificationReport?: VerificationReport;
}

/** Filters for listing optimization reports. */
export interface ReportFilterCriteria {
  status?: ReportStatus;
  resourceType?: string;
  confidenceLevel?: ConfidenceStatus | string;
  verificationStatus?: VerificationStatusValue | string;
  plugin?: PluginName;
}

/** Request to generate a report from a completed workflow. */
export interface GenerateReportRequest {
  workflowId: string;
}
