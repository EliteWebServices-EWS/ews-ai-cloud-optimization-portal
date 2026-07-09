/**
 * Decision Dashboard page — orchestrates API calls and component rendering.
 * Presentation layer only; all decisions come from the backend.
 */

import { getMockInstances, getWorkflow, runWorkflow } from '../api/workflowApi';
import { renderCandidateCard } from '../components/CandidateCard';
import { renderConfidenceIndicator } from '../components/ConfidenceIndicator';
import { renderEvidenceStatus } from '../components/EvidenceStatus';
import { renderFinancialImpactCard } from '../components/FinancialImpactCard';
import { renderGovernancePanel } from '../components/GovernancePanel';
import { renderOptimizationOverview } from '../components/OptimizationOverview';
import { renderRecommendationCard } from '../components/RecommendationCard';
import { renderStateMessage } from '../components/StateMessage';
import { renderVerificationPanel } from '../components/VerificationPanel';
import { renderWorkflowProgress } from '../components/WorkflowProgress';
import type { DashboardState, OverviewMetrics, WorkflowDetail } from '../types';
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
      this.setState('idle', 'Select a candidate and click Analyze Environment to run the optimization workflow.');
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : 'Unable to connect to backend API.';
      this.setState('error', message);
    }
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
