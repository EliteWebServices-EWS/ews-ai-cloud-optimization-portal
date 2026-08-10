/**
 * Builds optimization reports from persisted EC2 async intelligence outputs.
 * Does not invoke workflow engines or fabricate mock resources.
 */

import type { Ec2CostAnalysisRunRecord, Ec2CostRecommendationRecord } from '../../cloud-intelligence/ec2-cost/ec2-cost-models';
import type { Ec2SecuritySummaryRecord } from '../../cloud-intelligence/ec2-security/ec2-security-models';
import { buildAccountSecuritySummaryView } from '../../cloud-intelligence/ec2-security/ec2-security-summary-aggregate';
import type { Ec2AsyncJobRecord } from '../../async-jobs/ec2-async-job-models';
import type { Ec2DiscoveryRunRecord } from '../../repositories/models/cloud-resource-persistence-models';
import {
  FINANCIAL_STATUS,
  PLUGIN_NAMES,
  RECOMMENDATION_STATUS,
  REPORT_SOURCE,
  WORKFLOW_STATES,
} from '../../shared/constants';
import type {
  GovernanceSummary,
  OptimizationReport,
  ReportRecommendationEntry,
  ReportStatus,
  ReportSummary,
  ResourceSummary,
  SavingsSummary,
} from '../../shared/types';
import { deriveEc2AsyncReportId } from '../../shared/utils';
import { buildExportOptions } from './report.export';

export interface Ec2AsyncReportBuildInput {
  job: Ec2AsyncJobRecord;
  discoveryRun: Ec2DiscoveryRunRecord | null;
  costRun: Ec2CostAnalysisRunRecord | null;
  securityRunCompleted: boolean;
  securitySummaries: Ec2SecuritySummaryRecord[];
  openSecurityFindingCount: number;
  recommendations: Ec2CostRecommendationRecord[];
}

export function ec2AsyncReportWorkflowId(jobId: string): string {
  return `ec2-async:${jobId}`;
}

export function buildEc2AsyncOptimizationReport(input: Ec2AsyncReportBuildInput): OptimizationReport {
  const { job } = input;
  const createdAt = job.completedAt ?? new Date().toISOString();
  const instanceCount = resolveInstanceCount(input);
  const recommendations = buildRecommendationEntries(input.recommendations);
  const financialImpact = buildFinancialImpact(input.recommendations);
  const resources = buildResourceSummaries(input.recommendations);
  const status: ReportStatus = 'complete';
  const securityView = buildSecurityView(input);
  const summary = buildSummary(input, status, instanceCount, financialImpact, securityView);
  const region = job.regions[0] ?? 'unknown';

  return {
    reportId: deriveEc2AsyncReportId(job.tenantId, job.jobId),
    tenantId: job.tenantId,
    workflowId: ec2AsyncReportWorkflowId(job.jobId),
    plugin: PLUGIN_NAMES.EC2,
    status,
    workflowStatus: WORKFLOW_STATES.COMPLETED,
    createdAt,
    completedAt: job.completedAt ?? createdAt,
    region,
    reportSource: REPORT_SOURCE.EC2_ASYNC,
    ec2AsyncJobId: job.jobId,
    accountId: job.accountId,
    regions: [...job.regions],
    summary,
    resources,
    financialImpact,
    recommendations,
    evidence: buildEvidenceSummary(input, securityView),
    governance: buildGovernanceSummary(input, recommendations.length, securityView),
    exportOptions: buildExportOptions(),
  };
}

function resolveInstanceCount(input: Ec2AsyncReportBuildInput): number {
  if (input.costRun) {
    return input.costRun.instancesFound;
  }
  const fromDiscovery = input.discoveryRun?.resourceCounts?.INSTANCE;
  if (typeof fromDiscovery === 'number') {
    return fromDiscovery;
  }
  return 0;
}

function buildSummary(
  input: Ec2AsyncReportBuildInput,
  status: ReportStatus,
  instanceCount: number,
  financialImpact: SavingsSummary,
  securityView: ReturnType<typeof buildSecurityView>,
): ReportSummary {
  const opportunityCount = input.recommendations.length;
  const headline =
    instanceCount === 0
      ? `EC2 intelligence complete — no instances in account ${input.job.accountId}`
      : `EC2 intelligence complete — ${opportunityCount} optimization ${opportunityCount === 1 ? 'opportunity' : 'opportunities'}`;

  const executiveSummary =
    instanceCount === 0
      ? `Analysis completed for AWS account ${input.job.accountId}. No EC2 instances were discovered in the requested regions. Estimated monthly savings: ${formatMoney(0, financialImpact.currency)}. Security findings: ${securityView?.openFindingCount ?? 0}.`
      : `${instanceCount} EC2 instance${instanceCount === 1 ? '' : 's'} analyzed across ${input.job.regions.length} region(s). ${opportunityCount} cost recommendation${opportunityCount === 1 ? '' : 's'}. Estimated monthly savings: ${formatMoney(financialImpact.estimatedMonthlySavings, financialImpact.currency)}.`;

  const technicalSummary =
    instanceCount === 0
      ? `EC2 async job ${input.job.jobId} completed with zero instances in scope. Discovery, cost, and security stages finished successfully.`
      : `EC2 async job ${input.job.jobId} analyzed account ${input.job.accountId} in ${input.job.regions.join(', ')}.`;

  return {
    headline,
    opportunityCount,
    estimatedMonthlySavings: financialImpact.estimatedMonthlySavings,
    verifiedMonthlySavings: 0,
    verifiedCount: 0,
    currency: financialImpact.currency,
    optimizationStatus: status,
    executiveSummary,
    technicalSummary,
  };
}

function buildFinancialImpact(recommendations: Ec2CostRecommendationRecord[]): SavingsSummary {
  const estimatedMonthlySavings = recommendations.reduce(
    (sum, rec) => sum + (rec.estimatedMonthlySavings ?? 0),
    0,
  );
  const currentMonthlyCost = recommendations.reduce(
    (sum, rec) => sum + (rec.currentMonthlyCost ?? 0),
    0,
  );
  const projectedMonthlyCost = recommendations.reduce(
    (sum, rec) => sum + (rec.projectedMonthlyCost ?? 0),
    0,
  );

  return {
    currentMonthlyCost,
    projectedMonthlyCost,
    estimatedMonthlySavings,
    estimatedAnnualSavings: estimatedMonthlySavings * 12,
    verifiedMonthlySavings: 0,
    percentageReduction:
      currentMonthlyCost > 0
        ? Math.round((estimatedMonthlySavings / currentMonthlyCost) * 1000) / 10
        : 0,
    currency: recommendations[0]?.currency ?? 'USD',
    status: recommendations.length > 0 ? FINANCIAL_STATUS.ESTIMATED : FINANCIAL_STATUS.UNAVAILABLE,
  };
}

function buildResourceSummaries(recommendations: Ec2CostRecommendationRecord[]): ResourceSummary[] {
  return recommendations.map((rec) => ({
    resourceId: rec.resourceId,
    resourceType: rec.resourceType.toLowerCase(),
    region: rec.region,
    instanceType: rec.currentInstanceType,
    targetInstanceType: rec.candidateInstanceType,
  }));
}

function buildRecommendationEntries(
  recommendations: Ec2CostRecommendationRecord[],
): ReportRecommendationEntry[] {
  return recommendations.map((rec) => ({
    resourceId: rec.resourceId,
    resourceType: rec.resourceType.toLowerCase(),
    region: rec.region,
    decision: {
      recommendationStatus: RECOMMENDATION_STATUS.RECOMMENDED,
      confidenceScore: rec.confidenceScore,
      confidenceStatus: rec.confidenceLevel,
      governanceDecision: 'PENDING_REVIEW',
      governanceReason: 'Governance review applies when a cost recommendation is accepted for execution.',
      summary: rec.title,
      reason: rec.summary,
      action: rec.recommendedAction,
      fromInstanceType: rec.currentInstanceType,
      toInstanceType: rec.candidateInstanceType,
    },
    financialImpact: {
      currentMonthlyCost: rec.currentMonthlyCost ?? 0,
      projectedMonthlyCost: rec.projectedMonthlyCost ?? 0,
      estimatedMonthlySavings: rec.estimatedMonthlySavings ?? 0,
      estimatedAnnualSavings: rec.estimatedAnnualSavings ?? (rec.estimatedMonthlySavings ?? 0) * 12,
      verifiedMonthlySavings: 0,
      percentageReduction: 0,
      currency: rec.currency ?? 'USD',
      status: rec.pricingStatus === 'UNAVAILABLE' ? FINANCIAL_STATUS.UNAVAILABLE : FINANCIAL_STATUS.ESTIMATED,
    },
  }));
}

function buildSecurityView(input: Ec2AsyncReportBuildInput) {
  if (!input.securityRunCompleted || input.securitySummaries.length === 0) {
    return null;
  }
  return buildAccountSecuritySummaryView(input.securitySummaries, []);
}

function buildEvidenceSummary(
  input: Ec2AsyncReportBuildInput,
  securityView: ReturnType<typeof buildSecurityView>,
) {
  if (!input.securityRunCompleted) {
    return undefined;
  }

  return {
    status: 'COMPLETE',
    valid: true,
    errors: [] as string[],
    warnings: securityView?.warnings ?? [],
  };
}

function buildGovernanceSummary(
  input: Ec2AsyncReportBuildInput,
  recommendationCount: number,
  securityView: ReturnType<typeof buildSecurityView>,
): GovernanceSummary | undefined {
  if (!input.securityRunCompleted && recommendationCount === 0) {
    return undefined;
  }

  if (recommendationCount === 0) {
    return {
      decision: 'GOVERNANCE_STAGE_COMPLETE',
      readinessStatus: 'NO_ASSESSMENT',
      readinessScore: 0,
      reason:
        securityView?.warnings[0] ??
        'Governance analysis stage completed; no workflow governance assessment was persisted for this job.',
      policyCount: 0,
      failedPolicies: 0,
    };
  }

  if (!securityView) {
    return {
      decision: 'REVIEW_REQUIRED',
      readinessStatus: 'PARTIAL',
      readinessScore: 0,
      reason: 'Cost recommendations exist; security governance scores were not aggregated.',
      policyCount: 0,
      failedPolicies: 0,
    };
  }

  return {
    decision: 'REVIEW_REQUIRED',
    readinessStatus: securityView.scoreAvailability,
    readinessScore: securityView.governanceScore ?? 0,
    reason: `${recommendationCount} recommendation(s); ${securityView.openFindingCount} open security finding(s).`,
    policyCount: securityView.openFindingCount,
    failedPolicies: securityView.findingsBySeverity.critical + securityView.findingsBySeverity.high,
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
