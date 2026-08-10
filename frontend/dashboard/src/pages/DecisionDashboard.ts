/**
 * Decision Dashboard page — workflow analysis plus live EC2 decision widgets.
 */

import { renderStateMessage } from '../components/StateMessage';
import type { DashboardState } from '../types';
import { ApiClientError } from '../api/client';
import type { Ec2AsyncJobController } from '../ec2-async-job/Ec2AsyncJobController';
import type { Ec2DashboardController } from './Ec2DashboardController';

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

  static readonly LEGACY_WORKFLOW_DISCLAIMER =
    'Workflow panels are not updated by asynchronous EC2 jobs. Use live EC2 panels above.';

  constructor(
    private readonly elements: DecisionDashboardElements,
    private readonly ec2Dashboard: Ec2DashboardController,
    private readonly asyncJobs: Ec2AsyncJobController,
  ) {
    this.elements.analyzeButton.addEventListener('click', () => {
      void this.analyzeEnvironment();
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.ec2Dashboard.load();
      await this.asyncJobs.initialize();
      this.configureLegacyCandidateSelect();
      this.setState(
        'idle',
        'Live EC2 data loads above. Click Analyze Environment to run asynchronous EC2 analysis for the selected account and region.',
      );
      this.clearWorkflowPanels();
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : 'Unable to connect to backend API.';
      this.setState('error', message);
    }
  }

  private configureLegacyCandidateSelect(): void {
    const select = this.elements.candidateSelect;
    select.innerHTML = '';
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Legacy workflow candidate (not used for EC2 async analysis)';
    select.appendChild(option);
    select.disabled = true;
    select.setAttribute('aria-disabled', 'true');
  }

  async analyzeEnvironment(): Promise<void> {
    this.setState('loading', 'Submitting EC2 analysis job…');
    this.elements.analyzeButton.disabled = true;

    try {
      await this.asyncJobs.startAnalysisFromUi();
      this.setState(
        'success',
        'EC2 analysis queued. Track progress below; live EC2 panels refresh when the job completes.',
      );
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? `${error.message}${error.stage ? ` (stage: ${error.stage})` : ''}`
          : error instanceof Error
            ? error.message
            : 'Analysis failed.';
      this.setState('error', message);
    } finally {
      this.elements.analyzeButton.disabled = false;
    }
  }

  private setState(state: DashboardState, message?: string): void {
    this.state = state;
    renderStateMessage(this.elements.stateMessage, { state, message });
  }

  private clearWorkflowPanels(): void {
    this.elements.overview.innerHTML = `<p class="empty-note legacy-workflow-disclaimer">${DecisionDashboard.LEGACY_WORKFLOW_DISCLAIMER}</p>`;
    const placeholder = '<p class="empty-note legacy-workflow-placeholder">—</p>';
    for (const el of [
      this.elements.candidate,
      this.elements.evidence,
      this.elements.governance,
      this.elements.financial,
      this.elements.confidence,
      this.elements.recommendation,
      this.elements.verification,
    ]) {
      el.innerHTML = placeholder;
    }
  }

  getState(): DashboardState {
    return this.state;
  }

  getEc2Controller(): Ec2DashboardController {
    return this.ec2Dashboard;
  }
}
