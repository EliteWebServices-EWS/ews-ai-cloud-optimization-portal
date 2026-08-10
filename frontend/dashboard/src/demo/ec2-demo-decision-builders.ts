/**
 * Builds illustrative decision-intelligence snapshots from demo EC2 view models.
 * Values align with backend/providers/mock/data — not live engine execution.
 */

import type { Ec2DashboardViewModel } from '../ec2/ec2-dashboard-view-model';
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
import {
  DEMO_DECISION_WORKFLOW_STAGES,
  type DemoDecisionIntelligenceSnapshot,
  type DemoReportPreviewSnapshot,
} from './ec2-demo-decision-types';

const ILLUSTRATIVE_DISCLAIMER =
  'Illustrative decision-intelligence presentation — mock fixtures only; backend engines did not run on AWS.';

const LEARNING_OUTCOME =
  'Demo learning outcome prepared — not persisted to the production Learning Store.';

const MOCK_INSTANCE_META: Record<
  string,
  {
    instanceType: string;
    name: string;
    environment: string;
    team: string;
    avgCpu: number;
    avgMemory: number;
  }
> = {
  'i-mock-001': {
    instanceType: 't3.large',
    name: 'web-server-01',
    environment: 'production',
    team: 'platform',
    avgCpu: 12,
    avgMemory: 34,
  },
  'i-mock-002': {
    instanceType: 'm5.xlarge',
    name: 'dev-api-01',
    environment: 'development',
    team: 'backend',
    avgCpu: 8,
    avgMemory: 22,
  },
  'i-mock-003': {
    instanceType: 't3.medium',
    name: 'staging-worker',
    environment: 'staging',
    team: 'data',
    avgCpu: 19,
    avgMemory: 45,
  },
  'i-mock-004': {
    instanceType: 'c5.2xlarge',
    name: 'analytics-batch',
    environment: 'production',
    team: 'data',
    avgCpu: 5,
    avgMemory: 15,
  },
};

const MOCK_RESIZE: Record<string, { target: string; reason: string; savings: number }> = {
  'i-mock-001': {
    target: 't3.medium',
    reason: 'Sustained low CPU utilization over 14 days',
    savings: 30.37,
  },
  'i-mock-002': {
    target: 'm5.large',
    reason: 'Instance oversized for observed workload',
    savings: 70.08,
  },
  'i-mock-004': {
    target: 'c5.xlarge',
    reason: 'Compute instance underutilized',
    savings: 124.1,
  },
};

function illustrativeGovernance(environment: string, hasRecommendation: boolean): GovernanceResult {
  const decision = hasRecommendation
    ? environment === 'production'
      ? 'NEEDS APPROVAL'
      : 'APPROVED'
    : 'NOT APPLICABLE';
  return {
    status: 'READY',
    decision,
    readiness: {
      status: hasRecommendation ? 'READY' : 'NO_ASSESSMENT',
      factors: [],
    },
    reason: hasRecommendation
      ? 'Illustrative governance outcome based on mock policy catalog (demo only).'
      : 'No resize recommendation in mock fixture — governance review not required for demo narrative.',
    policies: hasRecommendation
      ? [
          {
            name: 'production-change-window',
            status: environment === 'production' ? 'WARN' : 'PASS',
            reason: 'Illustrative policy evaluation (demo).',
            severity: environment === 'production' ? 'MEDIUM' : 'LOW',
          },
          {
            name: 'cost-optimization-eligible',
            status: 'PASS',
            reason: 'Mock candidate eligible.',
            severity: 'LOW',
          },
        ]
      : [
          {
            name: 'optimization-candidate',
            status: 'PASS',
            reason: 'Balanced utilization — no action.',
            severity: 'LOW',
          },
        ],
  };
}

function buildEvidence(instanceId: string, meta: (typeof MOCK_INSTANCE_META)[string]): EvidenceView {
  return {
    status: 'COMPLETE',
    validation: { valid: true, errors: [], warnings: ['Demonstration/mock evidence — not live CloudWatch.'] },
    telemetry: {
      cpuUtilization: meta.avgCpu,
      memoryUtilization: meta.avgMemory,
      networkUtilization: 5,
      observationWindowDays: 14,
    },
    instance: {
      instanceId,
      instanceType: meta.instanceType,
      state: 'running',
      region: 'us-east-1',
    },
    recommendations: MOCK_RESIZE[instanceId]
      ? [
          {
            target: MOCK_RESIZE[instanceId].target,
            action: 'resize',
            reason: MOCK_RESIZE[instanceId].reason,
          },
        ]
      : [],
    tags: { Environment: meta.environment, Name: meta.name, Team: meta.team },
    collectedAt: '2026-07-15T12:00:00.000Z',
  };
}

function buildFinancialFromVm(vm: Ec2DashboardViewModel): FinancialImpact | undefined {
  const current = vm.cost.estimatedMonthlyCost;
  const savings = vm.cost.sampleEstimateMonthlySavings;
  if (current === undefined) {
    const fromBreakdown = vm.cost.costBreakdown?.currentMonthlyCost;
    if (fromBreakdown === undefined) {
      return undefined;
    }
    return {
      currentMonthlyCost: fromBreakdown,
      projectedMonthlyCost: fromBreakdown,
      monthlySavings: savings,
      annualSavings: savings * 12,
      percentageReduction: fromBreakdown > 0 ? (savings / fromBreakdown) * 100 : 0,
      status: 'ILLUSTRATIVE',
      currency: 'USD',
    };
  }
  const projected = Math.max(0, current - savings);
  const pct = current > 0 ? (savings / current) * 100 : 0;
  return {
    currentMonthlyCost: current,
    projectedMonthlyCost: projected,
    monthlySavings: savings,
    annualSavings: savings * 12,
    percentageReduction: pct,
    status: 'ILLUSTRATIVE',
    currency: 'USD',
  };
}

function confidenceFromRecommendation(level: string | undefined, reason: string): ConfidenceResult | undefined {
  if (!level) {
    return undefined;
  }
  return {
    status: level.toUpperCase(),
    reason,
  };
}

function formatDemoConfidenceSummary(
  confidenceUnavailable: boolean | undefined,
  confidence?: ConfidenceResult,
): string {
  if (confidenceUnavailable || !confidence) {
    return 'Not available for this demo scenario';
  }
  if (confidence.score != null) {
    return `${confidence.status} (${confidence.score}%) — ${confidence.reason}`;
  }
  return `${confidence.status} — ${confidence.reason}`;
}

function buildSimulatedExecution(
  scenarioId: string,
  fromType?: string,
  toType?: string,
): { execution: ExecutionResult; verification: VerificationResult; expectedSavings: number } {
  const expectedSavings = 0;
  const execution: ExecutionResult = {
    executionId: `demo-sim-${scenarioId}`,
    status: 'SIMULATED',
    success: false,
    message: 'Demo simulation only — no AWS resource was changed.',
    change:
      fromType && toType
        ? { action: 'resize', from: fromType, to: toType }
        : undefined,
  };
  const verification: VerificationResult = {
    status: 'NOT_EXECUTED',
    expectedSavings,
    actualSavings: 0,
    verifiedSavings: 0,
    variance: 0,
    variancePercentage: 0,
    stateMatched: false,
    message: 'Simulation only — no AWS resource was changed.',
  };
  return { execution, verification, expectedSavings };
}

function buildWorkflowDetail(
  scenarioId: string,
  vm: Ec2DashboardViewModel,
  instanceId: string,
  meta: (typeof MOCK_INSTANCE_META)[string] | undefined,
  resize?: (typeof MOCK_RESIZE)[string],
): WorkflowDetail {
  const evidence = meta ? buildEvidence(instanceId, meta) : undefined;
  return {
    metadata: {
      workflowId: `demo-workflow-${scenarioId}`,
      plugin: 'ec2',
      createdAt: vm.generatedAt,
      completedAt: vm.generatedAt,
      status: 'completed',
      executionState: 'completed',
      triggerSource: 'demo',
      region: vm.region,
    },
    status: 'completed',
    executionState: 'completed',
    completedStages: [...DEMO_DECISION_WORKFLOW_STAGES],
    failedStages: [],
    candidate: {
      resourceId: instanceId,
      resourceType: 'ec2',
      region: vm.region,
      tags: meta
        ? { Environment: meta.environment, Name: meta.name, Team: meta.team }
        : { Environment: 'demo', Name: 'Illustrative fleet' },
    },
    evidence,
    governance: illustrativeGovernance(meta?.environment ?? 'demo', Boolean(resize)),
    recommendation: resize
      ? {
          status: 'RECOMMENDED',
          summary: `Resize ${meta?.instanceType} → ${resize.target}`,
          reason: resize.reason,
          detail: {
            action: 'resize',
            fromInstanceType: meta!.instanceType,
            toInstanceType: resize.target,
            description: 'Mock provider recommendation (demo).',
          },
        }
      : undefined,
  };
}

function buildReportPreview(
  vm: Ec2DashboardViewModel,
  financial: FinancialImpact | undefined,
  recommendation?: RecommendationDecision,
  governance?: GovernanceResult,
  confidence?: ConfidenceResult,
  confidenceUnavailable?: boolean,
): DemoReportPreviewSnapshot {
  return {
    executiveHeadline: vm.executive.title,
    executiveSummary: vm.executive.headline,
    currentMonthlyCost: financial?.currentMonthlyCost,
    projectedMonthlyCost: financial?.projectedMonthlyCost,
    estimatedMonthlySavings: financial?.monthlySavings ?? 0,
    estimatedAnnualSavings: financial?.annualSavings ?? 0,
    recommendationSummary: recommendation?.summary ?? 'No optimization recommendation for this scenario',
    confidenceSummary: formatDemoConfidenceSummary(confidenceUnavailable, confidence),
    governanceDecision: governance?.decision ?? 'NOT APPLICABLE',
    verificationSummary: 'Simulated / not executed — no AWS change performed',
  };
}

function buildCandidateScenarioDecision(vm: Ec2DashboardViewModel): DemoDecisionIntelligenceSnapshot {
  const scenarioId = vm.demoScenarioId ?? 'unknown';
  const meta = MOCK_INSTANCE_META[scenarioId];
  const resize = MOCK_RESIZE[scenarioId];
  const costRec = vm.cost.recommendations[0];
  const hasRecommendation = Boolean(resize && costRec);

  const financial = buildFinancialFromVm(vm);
  if (financial && resize) {
    financial.monthlySavings = resize.savings;
    financial.annualSavings = resize.savings * 12;
    if (financial.currentMonthlyCost > 0) {
      financial.projectedMonthlyCost = Math.max(0, financial.currentMonthlyCost - resize.savings);
      financial.percentageReduction = (resize.savings / financial.currentMonthlyCost) * 100;
    }
  }

  const confidenceUnavailable = !hasRecommendation;
  const confidence = hasRecommendation
    ? confidenceFromRecommendation(
        costRec?.confidenceLevel,
        costRec?.businessJustification ?? resize!.reason,
      )
    : undefined;

  const governance = illustrativeGovernance(meta?.environment ?? 'demo', hasRecommendation);
  const evidence = meta ? buildEvidence(scenarioId, meta) : undefined;

  const recommendation: RecommendationDecision | undefined = hasRecommendation
    ? {
        status: 'RECOMMENDED',
        summary: costRec?.title ?? `Resize ${meta!.instanceType} → ${resize!.target}`,
        reason: resize!.reason,
        detail: {
          action: 'resize',
          fromInstanceType: meta!.instanceType,
          toInstanceType: resize!.target,
          description: costRec?.recommendedAction ?? 'Mock recommendation',
        },
        explanation: {
          governance: `Illustrative decision: ${governance.decision}`,
          financial: `$${resize!.savings.toFixed(2)}/mo illustrative savings`,
          confidence: confidence ? confidence.status : 'N/A',
        },
      }
    : undefined;

  const { execution, verification } = buildSimulatedExecution(
    scenarioId,
    meta?.instanceType,
    resize?.target,
  );
  if (resize) {
    verification.expectedSavings = resize.savings;
  }

  const workflowDetail = buildWorkflowDetail(scenarioId, vm, scenarioId, meta, resize);

  return {
    scenarioId,
    scenarioLabel: vm.demoScenarioLabel ?? scenarioId,
    illustrativeDisclaimer: ILLUSTRATIVE_DISCLAIMER,
    completedStages: [...DEMO_DECISION_WORKFLOW_STAGES],
    learningOutcome: LEARNING_OUTCOME,
    workflowDetail,
    evidence,
    governance,
    financial,
    confidenceUnavailable,
    confidence,
    recommendation,
    execution,
    verification,
    reportPreview: buildReportPreview(vm, financial, recommendation, governance, confidence, confidenceUnavailable),
  };
}

function buildFleetScenarioDecision(vm: Ec2DashboardViewModel): DemoDecisionIntelligenceSnapshot {
  const scenarioId = 'illustrative-fleet';
  const savings = vm.cost.sampleEstimateMonthlySavings;
  const financial = buildFinancialFromVm(vm);
  if (financial) {
    financial.monthlySavings = savings;
    financial.annualSavings = savings * 12;
    financial.status = 'ILLUSTRATIVE';
  }

  const governance: GovernanceResult = {
    status: 'READY',
    decision: 'NEEDS APPROVAL',
    readiness: { status: 'READY', factors: [] },
    reason: 'Illustrative fleet-level governance outcome (demo only).',
    policies: [
      {
        name: 'fleet-change-management',
        status: 'WARN',
        reason: 'Multiple instances — illustrative review.',
        severity: 'MEDIUM',
      },
      {
        name: 'security-exposure-review',
        status: 'WARN',
        reason: 'Synthetic findings present in demo fixture.',
        severity: 'MEDIUM',
      },
    ],
  };

  const evidence: EvidenceView = {
    status: 'COMPLETE',
    validation: { valid: true, errors: [], warnings: ['Fleet-level demonstration evidence — synthetic.'] },
    telemetry: {
      cpuUtilization: vm.averageCpuUtilization ?? 0,
      observationWindowDays: 14,
    },
    instance: {
      instanceId: 'illustrative-fleet',
      instanceType: 'mixed',
      state: 'running',
      region: vm.region,
    },
    tags: { Environment: 'demo', Name: 'Illustrative fleet' },
    collectedAt: vm.generatedAt,
  };

  const fleetRec = vm.cost.recommendations[0];
  const confidence = fleetRec?.confidenceLevel
    ? confidenceFromRecommendation(
        fleetRec.confidenceLevel,
        fleetRec.businessJustification ?? 'Illustrative fleet recommendation (demo fixture).',
      )
    : undefined;
  const confidenceUnavailable = !confidence;

  const recommendation: RecommendationDecision = {
    status: 'RECOMMENDED',
    summary: 'Review rightsizing across illustrative fleet workloads',
    reason: vm.executive.headline,
    detail: {
      action: 'review',
      fromInstanceType: 'mixed fleet',
      toInstanceType: 'rightsized mix',
      description: 'Curated demo fleet — not a single mock provider candidate.',
    },
  };

  const { execution, verification } = buildSimulatedExecution(scenarioId);
  verification.expectedSavings = savings;

  const workflowDetail = buildWorkflowDetail(scenarioId, vm, 'illustrative-fleet', undefined, undefined);
  workflowDetail.governance = governance;
  workflowDetail.recommendation = recommendation;

  return {
    scenarioId,
    scenarioLabel: vm.demoScenarioLabel ?? 'Illustrative multi-instance fleet',
    illustrativeDisclaimer: ILLUSTRATIVE_DISCLAIMER,
    completedStages: [...DEMO_DECISION_WORKFLOW_STAGES],
    learningOutcome: LEARNING_OUTCOME,
    workflowDetail,
    evidence,
    governance,
    financial,
    confidenceUnavailable,
    confidence,
    recommendation,
    execution,
    verification,
    reportPreview: buildReportPreview(
      vm,
      financial,
      recommendation,
      governance,
      confidence,
      confidenceUnavailable,
    ),
  };
}

export function buildDemoDecisionIntelligence(vm: Ec2DashboardViewModel): DemoDecisionIntelligenceSnapshot {
  if (vm.demoScenarioId === 'illustrative-fleet') {
    return buildFleetScenarioDecision(vm);
  }
  return buildCandidateScenarioDecision(vm);
}

export function attachDemoDecisionIntelligence(vm: Ec2DashboardViewModel): Ec2DashboardViewModel {
  return {
    ...vm,
    demoDecisionIntelligence: buildDemoDecisionIntelligence(vm),
  };
}
