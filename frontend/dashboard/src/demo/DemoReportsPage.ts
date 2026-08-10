/**
 * Public Demo Reports — deterministic scenario reports (no Reporting Engine / auth).
 */

import { attachDemoDecisionIntelligence } from './ec2-demo-decision-builders';
import { buildDemoScenarioViewModel } from './ec2-demo-scenario-view-models';
import {
  DEFAULT_DEMO_SCENARIO_ID,
  EC2_DEMO_SCENARIOS,
  getDemoScenarioById,
  listDemoScenarioIds,
} from './ec2-demo-scenarios';
import {
  renderDemoReportPreviewSection,
  renderDemoVerificationPanel,
} from './demo-decision-renderer';
import { buildEc2JsonReport } from '../ec2/render-ec2-dashboard';
import { escapeHtml } from '../utils/format';
import type { DemoDecisionIntelligenceSnapshot } from './ec2-demo-decision-types';

export interface DemoReportsPageElements {
  stateMessage: HTMLElement;
  reportList: HTMLElement;
  reportBody: HTMLElement;
  verificationPanel: HTMLElement;
  reportMeta: HTMLElement;
  exportButton: HTMLButtonElement;
}

export class DemoReportsPage {
  private selectedScenarioId = DEFAULT_DEMO_SCENARIO_ID;
  private snapshot: DemoDecisionIntelligenceSnapshot | null = null;

  constructor(private readonly elements: DemoReportsPageElements) {
    this.elements.exportButton.addEventListener('click', () => this.exportSampleJson());
    this.renderReportList();
  }

  initializeFromLocation(search: string): void {
    const params = new URLSearchParams(search);
    const requested = params.get('scenario');
    if (requested && getDemoScenarioById(requested)) {
      this.selectScenario(requested);
      return;
    }
    if (requested) {
      this.setMessage(
        `Unknown demo scenario "${requested}" — showing the default demo report selection.`,
      );
    }
    this.selectScenario(DEFAULT_DEMO_SCENARIO_ID);
  }

  listScenarioIds(): string[] {
    return listDemoScenarioIds();
  }

  getSelectedScenarioId(): string {
    return this.selectedScenarioId;
  }

  getSnapshot(): DemoDecisionIntelligenceSnapshot | null {
    return this.snapshot;
  }

  selectScenario(scenarioId: string): void {
    if (!getDemoScenarioById(scenarioId)) {
      return;
    }
    this.selectedScenarioId = scenarioId;
    const vm = attachDemoDecisionIntelligence(buildDemoScenarioViewModel(scenarioId));
    this.snapshot = vm.demoDecisionIntelligence ?? null;
    this.renderReportList();
    this.renderSelectedReport(vm.demoScenarioLabel ?? scenarioId, vm.region, vm.dataStatus);
    this.setMessage(
      `Demo report for ${vm.demoScenarioLabel ?? scenarioId} — demonstration data only; not persisted.`,
    );
    this.elements.exportButton.disabled = !vm.reports.available;
  }

  private renderReportList(): void {
    this.elements.reportList.innerHTML = `
      <ul class="report-list demo-report-list" role="list">
        ${EC2_DEMO_SCENARIOS.map(
          (scenario) => `
          <li>
            <button type="button" class="report-list-item${scenario.id === this.selectedScenarioId ? ' active' : ''}"
              data-scenario-id="${escapeHtml(scenario.id)}">
              <span class="report-list-title">${escapeHtml(scenario.label)}</span>
              <span class="report-list-meta">${escapeHtml(scenario.id)} · DEMO</span>
            </button>
          </li>`,
        ).join('')}
      </ul>
    `;

    for (const button of this.elements.reportList.querySelectorAll<HTMLButtonElement>(
      '[data-scenario-id]',
    )) {
      button.addEventListener('click', () => {
        const id = button.dataset.scenarioId;
        if (id) {
          this.selectScenario(id);
        }
      });
    }
  }

  private renderSelectedReport(label: string, region: string, dataStatus: string): void {
    if (!this.snapshot) {
      this.elements.reportBody.innerHTML = '<p class="empty-note">No demo report data.</p>';
      this.elements.verificationPanel.innerHTML = '';
      this.elements.reportMeta.innerHTML = '';
      return;
    }

    renderDemoReportPreviewSection(this.elements.reportBody, this.snapshot.reportPreview, {
      heading: 'Demo Report',
      subtitle:
        'Illustrative reports generated from SISU\'M demo scenarios. No live AWS account connected.',
    });
    renderDemoVerificationPanel(this.elements.verificationPanel, this.snapshot);

    this.elements.reportMeta.innerHTML = `
      <section class="dashboard-card report-meta-card">
        <h3 class="card-title">Report Details</h3>
        <dl class="detail-grid">
          <div><dt>Demo scenario ID</dt><dd>${escapeHtml(this.snapshot.scenarioId)}</dd></div>
          <div><dt>Region</dt><dd>${escapeHtml(region)}</dd></div>
          <div><dt>Source</dt><dd>DEMO — not persisted to production Reporting Engine</dd></div>
          <div><dt>Status</dt><dd>${escapeHtml(dataStatus)}</dd></div>
          <div><dt>Label</dt><dd>${escapeHtml(label)}</dd></div>
        </dl>
      </section>
    `;
  }

  exportSampleJson(): void {
    if (!this.snapshot) {
      return;
    }
    const vm = attachDemoDecisionIntelligence(buildDemoScenarioViewModel(this.selectedScenarioId));
    const json = buildEc2JsonReport(vm);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ec2-demo-sample-${this.selectedScenarioId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private setMessage(text: string): void {
    this.elements.stateMessage.hidden = false;
    this.elements.stateMessage.textContent = text;
  }
}
