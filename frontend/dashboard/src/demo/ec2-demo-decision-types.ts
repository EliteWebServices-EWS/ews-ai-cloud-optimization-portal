/**
 * Demo decision-intelligence snapshot — illustrative workflow outcomes only (no backend engines).
 */

import type {
  ConfidenceResult,
  EvidenceView,
  ExecutionResult,
  FinancialImpact,
  GovernanceResult,
  RecommendationDecision,
  VerificationResult,
  WorkflowDetail,
} from '../types';

export const DEMO_DECISION_WORKFLOW_STAGES = [
  'evidence',
  'governance',
  'financial',
  'confidence',
  'recommendation',
  'execution',
  'verification',
  'learning',
] as const;

export interface DemoReportPreviewSnapshot {
  executiveHeadline: string;
  executiveSummary: string;
  currentMonthlyCost?: number;
  projectedMonthlyCost?: number;
  estimatedMonthlySavings: number;
  estimatedAnnualSavings: number;
  recommendationSummary: string;
  confidenceSummary: string;
  governanceDecision: string;
  verificationSummary: string;
}

export interface DemoDecisionIntelligenceSnapshot {
  scenarioId: string;
  scenarioLabel: string;
  illustrativeDisclaimer: string;
  completedStages: readonly string[];
  learningOutcome: string;
  workflowDetail: WorkflowDetail;
  evidence?: EvidenceView;
  governance?: GovernanceResult;
  financial?: FinancialImpact;
  /** When true, show "Not available for this demo scenario" instead of confidence panel data. */
  confidenceUnavailable?: boolean;
  confidence?: ConfidenceResult;
  recommendation?: RecommendationDecision;
  execution: ExecutionResult;
  verification: VerificationResult;
  reportPreview: DemoReportPreviewSnapshot;
}

export interface DemoDecisionPanelElements {
  workflowProgress: HTMLElement;
  learningOutcome: HTMLElement;
  candidate: HTMLElement;
  evidence: HTMLElement;
  governance: HTMLElement;
  financial: HTMLElement;
  confidence: HTMLElement;
  recommendation: HTMLElement;
  verification: HTMLElement;
  reportPreview: HTMLElement;
}
