/**
 * Interactive public EC2 demo dashboard — scenario selection and mock analysis only.
 */

import type { Ec2DashboardController } from '../pages/Ec2DashboardController';
import { renderEc2DashboardPanels } from '../ec2/render-ec2-dashboard';
import type { Ec2DashboardPanelElements } from '../ec2/render-ec2-dashboard';
import { buildDemoIdleViewModel } from './ec2-demo-scenario-view-models';
import {
  DEFAULT_DEMO_SCENARIO_ID,
  EC2_DEMO_SCENARIOS,
  listDemoScenarioIds,
} from './ec2-demo-scenarios';

export type DemoAnalysisState = 'ready' | 'analyzing' | 'completed' | 'error';

export interface Ec2DemoDashboardElements {
  scenarioSelect: HTMLSelectElement;
  analyzeButton: HTMLButtonElement;
  stateMessage: HTMLElement;
  exportButton: HTMLButtonElement;
  panels: Ec2DashboardPanelElements;
}

const DEMO_ANALYSIS_DELAY_MS = 350;

export class Ec2DemoDashboard {
  private analysisState: DemoAnalysisState = 'ready';
  private selectedScenarioId = DEFAULT_DEMO_SCENARIO_ID;
  private lastAnalyzedScenarioId: string | null = null;

  constructor(
    private readonly elements: Ec2DemoDashboardElements,
    private readonly ec2Controller: Ec2DashboardController,
  ) {
    this.populateScenarioSelect();
    this.elements.analyzeButton.addEventListener('click', () => {
      void this.analyzeDemoEnvironment();
    });
    this.elements.scenarioSelect.addEventListener('change', () => {
      this.selectedScenarioId = this.elements.scenarioSelect.value;
      if (this.analysisState === 'completed' && this.lastAnalyzedScenarioId !== this.selectedScenarioId) {
        this.setAnalysisState('ready', 'Scenario changed — click Analyze Demo Environment to refresh results.');
      }
    });
    this.renderIdle();
  }

  populateScenarioSelect(): void {
    this.elements.scenarioSelect.innerHTML = EC2_DEMO_SCENARIOS.map(
      (scenario) =>
        `<option value="${scenario.id}">${scenario.label}</option>`,
    ).join('');
    this.elements.scenarioSelect.value = DEFAULT_DEMO_SCENARIO_ID;
    this.selectedScenarioId = DEFAULT_DEMO_SCENARIO_ID;
  }

  getAnalysisState(): DemoAnalysisState {
    return this.analysisState;
  }

  getSelectedScenarioId(): string {
    return this.selectedScenarioId;
  }

  getLastAnalyzedScenarioId(): string | null {
    return this.lastAnalyzedScenarioId;
  }

  listScenarioIds(): string[] {
    return listDemoScenarioIds();
  }

  private setAnalysisState(state: DemoAnalysisState, message?: string): void {
    this.analysisState = state;
    if (message) {
      this.elements.stateMessage.hidden = false;
      this.elements.stateMessage.textContent = message;
    } else {
      this.elements.stateMessage.hidden = true;
      this.elements.stateMessage.textContent = '';
    }
  }

  private renderIdle(): void {
    const idle = buildDemoIdleViewModel();
    renderEc2DashboardPanels(this.elements.panels, idle);
    this.setAnalysisState('ready', 'Ready — select a demo scenario and click Analyze Demo Environment.');
    this.elements.exportButton.disabled = true;
  }

  async analyzeDemoEnvironment(): Promise<void> {
    this.selectedScenarioId = this.elements.scenarioSelect.value;
    this.elements.analyzeButton.disabled = true;
    this.setAnalysisState('analyzing', 'Analyzing demo scenario… (mock provider snapshot, not live AWS)');

    await new Promise((resolve) => setTimeout(resolve, DEMO_ANALYSIS_DELAY_MS));

    try {
      await this.ec2Controller.loadDemoScenario(this.selectedScenarioId);
      const vm = this.ec2Controller.getViewModel();
      if (!vm || vm.dataStatus === 'ERROR') {
        this.setAnalysisState('error', 'Demo analysis failed. Retry or choose another scenario.');
        this.elements.exportButton.disabled = true;
        return;
      }
      this.lastAnalyzedScenarioId = this.selectedScenarioId;
      this.setAnalysisState(
        'completed',
        `Completed — ${vm.demoScenarioLabel ?? this.selectedScenarioId} (demonstration data only).`,
      );
      this.elements.exportButton.disabled = !vm.reports.available;
    } catch {
      this.setAnalysisState('error', 'Demo analysis failed.');
      this.elements.exportButton.disabled = true;
    } finally {
      this.elements.analyzeButton.disabled = false;
    }
  }

  exportSampleJson(): void {
    const json = this.ec2Controller.exportJsonReport();
    if (!json) {
      return;
    }
    const vm = this.ec2Controller.getViewModel();
    const scenarioPart = vm?.demoScenarioId ?? this.lastAnalyzedScenarioId ?? 'demo';
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ec2-demo-sample-${scenarioPart}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
