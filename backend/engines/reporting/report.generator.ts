/**
 * Report generator — aggregates workflow results into structured optimization reports.
 * Presentation layer only: does not calculate savings or re-evaluate governance.
 */

import { RECOMMENDATION_STATUS, VERIFICATION_STATUS, WORKFLOW_STATES } from '../../shared/constants';
import type {
  DecisionSummary,
  EvidenceSummary,
  GovernanceSummary,
  OptimizationReport,
  ReportGenerationInput,
  ReportRecommendationEntry,
  ReportStatus,
  ReportSummary,
  ResourceSummary,
  SavingsSummary,
  VerificationSummary,
} from '../../shared/types';
import { generateReportId } from '../../shared/utils';
import { buildExportOptions } from './report.export';

/** Generate an executive summary using deterministic templates. */
export function generateExecutiveSummary(input: ReportGenerationInput): string {
  const opportunityCount = input.candidate ? 1 : 0;
  const monthlySavings = input.financialImpact?.monthlySavings ?? 0;
  const currency = input.financialImpact?.currency ?? 'USD';
  const verifiedCount =
    input.verification?.status === VERIFICATION_STATUS.VERIFIED ? 1 : 0;

  if (opportunityCount === 0) {
    return 'No optimization opportunities identified in this workflow.';
  }

  const savingsLine =
    monthlySavings > 0
      ? `Estimated monthly savings: ${formatMoney(monthlySavings, currency)}.`
      : 'No estimated monthly savings available for this workflow.';

  const verificationLine =
    verifiedCount > 0
      ? `${verifiedCount} recommendation verified successfully.`
      : input.verification
        ? `Verification status: ${input.verification.status}.`
        : 'Verification has not been completed.';

  return `${opportunityCount} optimization ${opportunityCount === 1 ? 'opportunity' : 'opportunities'} identified. ${savingsLine} ${verificationLine}`;
}

/** Generate a technical summary describing resource and configuration changes. */
export function generateTechnicalSummary(input: ReportGenerationInput): string {
  const parts: string[] = [];

  if (input.candidate) {
    parts.push(
      `Analyzed ${input.candidate.resourceType} resource ${input.candidate.resourceId} in ${input.candidate.region}.`
    );
  }

  if (input.evidence) {
    parts.push(
      `Evidence collected: CPU ${input.evidence.telemetry.cpuUtilization}% avg, memory ${input.evidence.telemetry.memoryUtilization}% avg over ${input.evidence.telemetry.observationWindowDays} days.`
    );
  }

  if (input.execution?.change) {
    parts.push(
      `Configuration change: ${input.execution.change.action} from ${input.execution.change.from} to ${input.execution.change.to}.`
    );
  } else if (input.recommendation?.detail) {
    parts.push(
      `Proposed change: ${input.recommendation.detail.action} from ${input.recommendation.detail.fromInstanceType} to ${input.recommendation.detail.toInstanceType}.`
    );
  }

  if (input.governance) {
    parts.push(
      `Governance: ${input.governance.decision} — ${input.governance.reason}.`
    );
  }

  if (input.verification) {
    parts.push(
      `Verification: ${input.verification.status}, variance ${input.verification.variancePercentage.toFixed(1)}%.`
    );
  }

  if (parts.length === 0) {
    return 'Insufficient workflow data for a technical summary.';
  }

  return parts.join(' ');
}

/**
 * Generate a structured optimization report from workflow result data.
 * Aggregates existing engine outputs without recalculating business logic.
 */
export function generateReport(input: ReportGenerationInput): OptimizationReport {
  const reportId = generateReportId();
  const createdAt = new Date().toISOString();
  const status = resolveReportStatus(input);
  const resources = buildResourceSummaries(input);
  const financialImpact = buildSavingsSummary(input);
  const recommendations = buildRecommendationEntries(input);
  const evidence = buildEvidenceSummary(input);
  const governance = buildGovernanceSummary(input);
  const verification = buildVerificationSummary(input);
  const executiveSummary = generateExecutiveSummary(input);
  const technicalSummary = generateTechnicalSummary(input);
  const verifiedSavings =
    input.verification?.status === VERIFICATION_STATUS.VERIFIED
      ? input.verification.verifiedSavings
      : 0;
  const verifiedCount =
    input.verification?.status === VERIFICATION_STATUS.VERIFIED ? 1 : 0;

  const summary: ReportSummary = {
    headline: buildHeadline(input, status),
    opportunityCount: resources.length,
    estimatedMonthlySavings: financialImpact.estimatedMonthlySavings,
    verifiedMonthlySavings: verifiedSavings,
    verifiedCount,
    currency: financialImpact.currency,
    optimizationStatus: status,
    executiveSummary,
    technicalSummary,
  };

  return {
    reportId,
    workflowId: input.workflowId,
    plugin: input.plugin,
    status,
    workflowStatus: input.status,
    createdAt,
    completedAt: input.completedAt,
    region: input.region,
    summary,
    resources,
    financialImpact,
    recommendations,
    evidence,
    governance,
    verification,
    exportOptions: buildExportOptions(),
  };
}

function resolveReportStatus(input: ReportGenerationInput): ReportStatus {
  if (input.status === WORKFLOW_STATES.FAILED) {
    return 'failed';
  }

  if (!input.candidate) {
    return 'empty';
  }

  const hasRecommendation = Boolean(input.recommendation);
  const hasFinancial = Boolean(input.financialImpact);
  const hasVerification = Boolean(input.verification);

  if (hasRecommendation && hasFinancial && hasVerification) {
    return 'complete';
  }

  if (hasRecommendation || hasFinancial) {
    return 'partial';
  }

  return 'empty';
}

function buildHeadline(input: ReportGenerationInput, status: ReportStatus): string {
  if (status === 'failed') {
    return 'Optimization workflow failed before report completion';
  }

  if (status === 'empty') {
    return 'No optimization data available for this workflow';
  }

  const action = input.recommendation?.summary ?? 'Optimization analysis';
  const resourceId = input.candidate?.resourceId ?? 'unknown resource';
  return `${action} for ${resourceId}`;
}

function buildResourceSummaries(input: ReportGenerationInput): ResourceSummary[] {
  if (!input.candidate) {
    return [];
  }

  const environment =
    input.candidate.tags?.Environment ??
    input.evidence?.tags?.Environment ??
    input.evidence?.instance?.state;

  return [
    {
      resourceId: input.candidate.resourceId,
      resourceType: input.candidate.resourceType,
      region: input.candidate.region,
      instanceType: input.evidence?.instance?.instanceType,
      targetInstanceType:
        input.recommendation?.detail?.toInstanceType ??
        input.evidence?.recommendations[0]?.target,
      environment,
      evidenceStatus: input.evidenceStatus,
      cpuUtilization: input.evidence?.telemetry.cpuUtilization,
      memoryUtilization: input.evidence?.telemetry.memoryUtilization,
    },
  ];
}

function buildSavingsSummary(input: ReportGenerationInput): SavingsSummary {
  const financial = input.financialImpact;
  const verifiedSavings =
    input.verification?.status === VERIFICATION_STATUS.VERIFIED
      ? input.verification.verifiedSavings
      : 0;

  if (!financial) {
    return {
      currentMonthlyCost: 0,
      projectedMonthlyCost: 0,
      estimatedMonthlySavings: 0,
      estimatedAnnualSavings: 0,
      verifiedMonthlySavings: verifiedSavings,
      percentageReduction: 0,
      currency: 'USD',
      status: 'UNAVAILABLE',
    };
  }

  return {
    currentMonthlyCost: financial.currentMonthlyCost,
    projectedMonthlyCost: financial.projectedMonthlyCost,
    estimatedMonthlySavings: financial.monthlySavings,
    estimatedAnnualSavings: financial.annualSavings,
    verifiedMonthlySavings: verifiedSavings,
    percentageReduction: financial.percentageReduction,
    currency: financial.currency,
    status: financial.status,
  };
}

function buildDecisionSummary(input: ReportGenerationInput): DecisionSummary {
  return {
    recommendationStatus: input.recommendation?.status ?? RECOMMENDATION_STATUS.INSUFFICIENT_DATA,
    confidenceScore: input.confidence?.score ?? 0,
    confidenceStatus: input.confidence?.status ?? 'LOW',
    governanceDecision: input.governance?.decision ?? 'unknown',
    governanceReason: input.governance?.reason ?? 'Governance evaluation not available',
    summary: input.recommendation?.summary ?? 'No recommendation generated',
    reason: input.recommendation?.reason ?? 'Insufficient workflow data',
    action: input.recommendation?.detail?.action,
    fromInstanceType: input.recommendation?.detail?.fromInstanceType,
    toInstanceType: input.recommendation?.detail?.toInstanceType,
  };
}

function buildRecommendationEntries(input: ReportGenerationInput): ReportRecommendationEntry[] {
  if (!input.candidate) {
    return [];
  }

  return [
    {
      resourceId: input.candidate.resourceId,
      resourceType: input.candidate.resourceType,
      region: input.candidate.region,
      decision: buildDecisionSummary(input),
      financialImpact: input.financialImpact ? buildSavingsSummary(input) : undefined,
      verification: input.verification ? buildVerificationSummary(input) : undefined,
    },
  ];
}

function buildEvidenceSummary(input: ReportGenerationInput): EvidenceSummary | undefined {
  if (!input.evidence && !input.validation) {
    return undefined;
  }

  return {
    status: input.evidenceStatus,
    valid: input.validation?.valid ?? false,
    errors: input.validation?.errors ?? [],
    warnings: input.validation?.warnings ?? [],
    observationWindowDays: input.evidence?.telemetry.observationWindowDays,
    collectedAt: input.evidence?.collectedAt,
  };
}

function buildGovernanceSummary(input: ReportGenerationInput): GovernanceSummary | undefined {
  if (!input.governance) {
    return undefined;
  }

  const failedPolicies = input.governance.policies.filter((p) => p.status === 'FAIL').length;

  return {
    decision: input.governance.decision,
    readinessStatus: input.governance.status,
    readinessScore: input.governance.readinessScore,
    reason: input.governance.reason,
    approver: input.governance.approver,
    policyCount: input.governance.policies.length,
    failedPolicies,
  };
}

function buildVerificationSummary(input: ReportGenerationInput): VerificationSummary | undefined {
  if (!input.verification) {
    return undefined;
  }

  return {
    status: input.verification.status,
    expectedSavings: input.verification.expectedSavings,
    actualSavings: input.verification.actualSavings,
    verifiedSavings: input.verification.verifiedSavings,
    variance: input.verification.variance,
    variancePercentage: input.verification.variancePercentage,
    stateMatched: input.verification.stateMatched,
    message: input.verification.message ?? input.verificationReport?.summary,
  };
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
