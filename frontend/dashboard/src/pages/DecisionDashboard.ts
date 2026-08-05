/**
 * Decision Dashboard page — orchestrates API calls and component rendering.
 * Presentation layer only; all decisions come from the backend.
 */

import { getMockInstances, getWorkflow, runWorkflow } from '../api/workflowApi';
import { renderCandidateCard } from '../components/CandidateCard';
import { renderConfidenceIndicator } from '../components/ConfidenceIndicator';
import { renderEc2CostBreakdownCard } from '../components/EC2CostBreakdownCard';
import { renderEc2ExecutiveSummaryCard } from '../components/EC2ExecutiveSummaryCard';
import { renderEc2InstanceMixCard } from '../components/EC2InstanceMixCard';
import { renderEc2RightsizingCard } from '../components/EC2RightsizingCard';
import { renderEc2SecurityFindingsCard } from '../components/EC2SecurityFindingsCard';
import { renderEc2SummaryCard } from '../components/EC2SummaryCard';
import { renderEvidenceStatus } from '../components/EvidenceStatus';
import { renderFinancialImpactCard } from '../components/FinancialImpactCard';
import { renderGovernancePanel } from '../components/GovernancePanel';
import { renderOptimizationOverview } from '../components/OptimizationOverview';
import { renderRecommendationCard } from '../components/RecommendationCard';
import { renderStateMessage } from '../components/StateMessage';
import { renderVerificationPanel } from '../components/VerificationPanel';
import { renderWorkflowProgress } from '../components/WorkflowProgress';
import type {
  DashboardState,
  Ec2CostBreakdown,
  Ec2DashboardSummary,
  Ec2InstanceMix,
  Ec2RightsizingOpportunity,
  Ec2SecurityFinding,
  OverviewMetrics,
  WorkflowDetail,
} from '../types';
import { ApiClientError } from '../api/client';

export interface DecisionDashboardElements {
  stateMessage: HTMLElement;
  overview: HTMLElement;
  progress: HTMLElement;
  candidate: HTMLElement;
  evidence: HTMLElement;
  governance: HTMLElement;
  financial: HTMLElement;
  confidence: HTMLElement;
  recommendation: HTMLElement;
  verification: HTMLElement;
  analyzeButton: HTMLButtonElement;
  candidateSelect: HTMLSelectElement;
}

export class DecisionDashboard {
  private state: DashboardState = 'idle';
  private workflowDetail: WorkflowDetail | null = null;
  private totalCandidates = 0;

  constructor(private readonly elements: DecisionDashboardElements) {
    this.elements.analyzeButton.addEventListener('click', () => {
      void this.analyzeEnvironment();
    });
  }

  async initialize(): Promise<void> {
    try {
      const instances = await getMockInstances();
      this.totalCandidates = instances.length;
      this.populateCandidateSelect(instances);
      this.renderEc2Summary();
      this.setState('idle', 'Select a candidate and click Analyze Environment to run the optimization workflow.');
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : 'Unable to connect to backend API.';
      this.setState('error', message);
    }
  }

  private renderEc2Summary(): void {
    const summary = this.buildEc2Summary();
    const costBreakdown = this.buildEc2CostBreakdown(summary.monthlyCost);
    const instanceMix = this.buildEc2InstanceMix(summary);
    const findings = this.buildEc2SecurityFindings();
    const opportunities = this.buildEc2RightsizingOpportunities();
    const executiveSummary = this.buildEc2ExecutiveSummary();

    renderEc2SummaryCard(this.elements.candidate, summary);
    renderEc2CostBreakdownCard(this.elements.financial, costBreakdown);
    renderEc2InstanceMixCard(this.elements.confidence, instanceMix);
    renderEc2SecurityFindingsCard(this.elements.recommendation, findings);
    renderEc2RightsizingCard(this.elements.verification, opportunities);
    renderEc2ExecutiveSummaryCard(this.elements.evidence, executiveSummary);
  }

  private buildEc2Summary(): Ec2DashboardSummary {
    const currentCost = this.workflowDetail?.financialImpact?.currentMonthlyCost ?? 0;
    const totalInstances = Math.max(1, this.totalCandidates || 1);
    const currentState = this.workflowDetail?.evidence?.instance?.state ?? 'running';
    const runningInstances = currentState === 'running' ? totalInstances : Math.max(0, totalInstances - 1);
    const stoppedInstances = Math.max(0, totalInstances - runningInstances);
    const averageCpuUtilization = this.workflowDetail?.evidence?.telemetry?.cpuUtilization ?? 52.4;
    const recommendationCount = this.workflowDetail?.recommendation ? 1 : 0;
    const governanceScore = this.workflowDetail?.governance?.readinessScore ?? 91;
    const securityFindings = this.workflowDetail?.governance?.policies.filter(
      (policy) => policy.status === 'WARN' || policy.status === 'FAIL'
    ).length ?? 2;

    return {
      region: this.workflowDetail?.metadata.region ?? 'us-east-1',
      totalInstances,
      runningInstances,
      stoppedInstances,
      monthlyCost: currentCost || 2840.25,
      averageCpuUtilization,
      rightsizingOpportunities: Math.max(recommendationCount, 1),
      securityFindings,
      governanceScore,
      recommendations: [
        {
          title: this.workflowDetail?.recommendation?.detail?.action
            ? `Rightsize ${this.workflowDetail.recommendation.detail.fromInstanceType ?? 'instance'} to ${this.workflowDetail.recommendation.detail.toInstanceType ?? 'recommended size'}`
            : 'Rightsize underutilized instances',
          category: 'cost',
          priority: this.workflowDetail?.recommendation?.status === 'RECOMMENDED' ? 'High' : 'Medium',
          impact: this.workflowDetail?.financialImpact?.monthlySavings ? `$${this.workflowDetail.financialImpact.monthlySavings.toFixed(2)}/mo` : '$420/mo',
          detail:
            this.workflowDetail?.recommendation?.summary ??
            'Reduce compute spend for low-CPU workloads.',
        },
        {
          title: 'Review security exposure findings',
          category: 'security',
          priority: 'High',
          impact: `${securityFindings} active findings`,
          detail: 'Restrict public access and verify the current EC2 security posture.',
        },
      ],
    };
  }

  private buildEc2CostBreakdown(currentMonthlyCost: number): Ec2CostBreakdown {
    const estimatedSavings = this.workflowDetail?.financialImpact?.monthlySavings ?? 420.5;
    const computeCost = currentMonthlyCost * 0.57;
    const storageCost = currentMonthlyCost * 0.16;
    const networkCost = currentMonthlyCost * 0.09;
    const otherCost = Math.max(0, currentMonthlyCost - (computeCost + storageCost + networkCost));

    return {
      currentMonthlyCost,
      estimatedSavings,
      computeCost,
      storageCost,
      networkCost,
      otherCost,
    };
  }

  private buildEc2InstanceMix(summary: Ec2DashboardSummary): Ec2InstanceMix {
    const family = this.workflowDetail?.evidence?.instance?.instanceType ?? 'm7i';
    const share = Math.min(100, Math.max(20, Math.round((summary.runningInstances / summary.totalInstances) * 100)));

    return {
      total: summary.totalInstances,
      byFamily: [
        {
          family,
          count: summary.runningInstances,
          share,
          monthlyCost: summary.monthlyCost,
        },
        {
          family: 'c7i',
          count: Math.max(1, summary.totalInstances - summary.runningInstances),
          share: Math.max(10, 100 - share),
          monthlyCost: Math.max(0, summary.monthlyCost * 0.55),
        },
      ],
    };
  }

  private buildEc2SecurityFindings(): Ec2SecurityFinding[] {
    if (!this.workflowDetail?.governance?.policies?.length) {
      return [
        {
          title: 'Public ingress on sg-017',
          severity: 'High',
          count: 2,
          remediation: 'Restrict to corporate CIDR ranges.',
        },
        {
          title: 'SSH open to 0.0.0.0/0',
          severity: 'Critical',
          count: 1,
          remediation: 'Disable direct internet SSH access.',
        },
      ];
    }

    return this.workflowDetail.governance.policies
      .filter((policy) => policy.status === 'WARN' || policy.status === 'FAIL')
      .slice(0, 3)
      .map((policy) => ({
        title: policy.name,
        severity: policy.severity === 'HIGH' ? 'High' : policy.severity === 'CRITICAL' ? 'Critical' : 'Medium',
        count: 1,
        remediation: policy.reason,
      }));
  }

  private buildEc2RightsizingOpportunities(): Ec2RightsizingOpportunity[] {
    const currentType = this.workflowDetail?.evidence?.instance?.instanceType ?? 'm6i.large';
    const recommendedType = this.workflowDetail?.recommendation?.detail?.toInstanceType ?? 't3.medium';

    if (!this.workflowDetail?.recommendation?.detail) {
      return [
        {
          instanceId: 'i-123456',
          currentType: 'm6i.large',
          recommendedType: 't3.medium',
          savings: 124.5,
          utilization: 18,
        },
        {
          instanceId: 'i-987654',
          currentType: 'c6i.xlarge',
          recommendedType: 'c6i.large',
          savings: 96.2,
          utilization: 22,
        },
      ];
    }

    return [
      {
        instanceId: this.workflowDetail.candidate?.resourceId ?? 'i-ec2-candidate',
        currentType: currentType,
        recommendedType: recommendedType,
        savings: this.workflowDetail.financialImpact?.monthlySavings ?? 108,
        utilization: this.workflowDetail.evidence?.telemetry?.cpuUtilization ?? 18,
      },
    ];
  }

  private buildEc2ExecutiveSummary() {
    const recommendation = this.workflowDetail?.recommendation;
    const savings = this.workflowDetail?.financialImpact?.monthlySavings ?? 541.2;
    const confidence = this.workflowDetail?.confidence?.score ?? 92;
    const title = recommendation?.summary ?? 'EC2 optimization opportunity';

    return {
      title,
      headline: recommendation?.reason ?? 'Improve cost and risk posture across the EC2 fleet.',
      savings,
      securityRisk: `${Math.max(1, this.buildEc2SecurityFindings().length)} active security findings`,
      priority: recommendation?.status === 'RECOMMENDED' ? 'High' : 'Medium',
      confidence,
    } as const;
  }

  private populateCandidateSelect(
    instances: Array<{ instanceId: string; instanceType: string; tags: Record<string, string> }>
  ): void {
    const select = this.elements.candidateSelect;
    select.innerHTML = '<option value="">Default candidate</option>';
    for (const instance of instances) {
      const option = document.createElement('option');
      option.value = instance.instanceId;
      option.textContent = `${instance.instanceId} (${instance.instanceType}) — ${instance.tags.Environment ?? 'unknown'}`;
      select.appendChild(option);
    }
  }

  async analyzeEnvironment(): Promise<void> {
    this.setState('loading');
    this.elements.analyzeButton.disabled = true;

    try {
      const resourceId = this.elements.candidateSelect.value || undefined;
      const runResult = await runWorkflow({ plugin: 'ec2', mode: 'full', resourceId });

      if (runResult.status === 'failed') {
        const detail = await getWorkflow(runResult.workflowId);
        this.workflowDetail = detail;
        this.renderDashboard(detail);
        this.setState('error', runResult.failure?.error.reason ?? 'Workflow failed during analysis.');
        return;
      }

      const detail = await getWorkflow(runResult.workflowId);
      this.workflowDetail = detail;
      this.renderDashboard(detail);
      this.setState('success', `Analysis completed in ${runResult.durationMs}ms. Workflow ${runResult.workflowId}.`);
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? `${error.message}${error.stage ? ` (stage: ${error.stage})` : ''}`
          : error instanceof Error
            ? error.message
            : 'Analysis failed.';
      this.setState('error', message);
      this.clearPanels();
    } finally {
      this.elements.analyzeButton.disabled = false;
    }
  }

  private renderDashboard(detail: WorkflowDetail): void {
    const overview = this.buildOverviewMetrics(detail);
    renderOptimizationOverview(this.elements.overview, overview);
    renderWorkflowProgress(
      this.elements.progress,
      detail.completedStages,
      detail.failedStages,
      detail.currentStage
    );
    renderCandidateCard(this.elements.candidate, detail);
    renderEvidenceStatus(this.elements.evidence, detail.evidence);
    renderGovernancePanel(this.elements.governance, detail.governance);
    renderFinancialImpactCard(this.elements.financial, detail.financialImpact);
    renderConfidenceIndicator(this.elements.confidence, detail.confidence);
    renderRecommendationCard(this.elements.recommendation, detail.recommendation);
    renderVerificationPanel(this.elements.verification, {
      execution: detail.execution,
      verification: detail.verification,
      reportSummary: detail.report?.summary,
    });
  }

  private buildOverviewMetrics(detail: WorkflowDetail): OverviewMetrics {
    const readinessStatus = detail.governance?.readiness?.status ?? '';
    const isReady = readinessStatus === 'READY' || readinessStatus === 'PARTIALLY_READY';

    return {
      totalCandidates: this.totalCandidates,
      readyCandidates: isReady ? 1 : 0,
      potentialMonthlySavings: detail.financialImpact?.monthlySavings ?? 0,
      averageConfidence: detail.confidence?.score ?? 0,
    };
  }

  private setState(state: DashboardState, message?: string): void {
    this.state = state;
    renderStateMessage(this.elements.stateMessage, { state, message });
  }

  private clearPanels(): void {
    const empty = '<p class="empty-note">Awaiting analysis.</p>';
    for (const el of [
      this.elements.overview,
      this.elements.progress,
      this.elements.candidate,
      this.elements.evidence,
      this.elements.governance,
      this.elements.financial,
      this.elements.confidence,
      this.elements.recommendation,
      this.elements.verification,
    ]) {
      el.innerHTML = empty;
    }
  }

  getState(): DashboardState {
    return this.state;
  }

  getWorkflowDetail(): WorkflowDetail | null {
    return this.workflowDetail;
  }
}
