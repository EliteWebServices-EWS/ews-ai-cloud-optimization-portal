/**
 * Reports Page — displays optimization reports from the Reporting Engine.
 * Presentation layer only; all data sourced from backend API.
 */

import { generateReport, getReport, listReports } from '../api/reportApi';
import { runWorkflow } from '../api/workflowApi';
import { renderRecommendationSummary } from '../components/RecommendationSummary';
import { renderReportSummaryCard } from '../components/ReportSummaryCard';
import { renderSavingsSummaryCard } from '../components/SavingsSummaryCard';
import { renderStateMessage } from '../components/StateMessage';
import { renderVerificationSummary } from '../components/VerificationSummary';
import type { DashboardState, OptimizationReport, ReportFilterParams, ReportListItem } from '../types';
import { ApiClientError } from '../api/client';

export interface ReportsPageElements {
  stateMessage: HTMLElement;
  filtersForm: HTMLFormElement;
  reportList: HTMLElement;
  reportDetail: HTMLElement;
  summaryPanel: HTMLElement;
  savingsPanel: HTMLElement;
  recommendationPanel: HTMLElement;
  verificationPanel: HTMLElement;
  generateButton: HTMLButtonElement;
  refreshButton: HTMLButtonElement;
}

export class ReportsPage {
  private state: DashboardState = 'idle';
  private reports: ReportListItem[] = [];
  private selectedReport: OptimizationReport | null = null;
  private filters: ReportFilterParams = {};

  constructor(private readonly elements: ReportsPageElements) {
    this.elements.filtersForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.applyFilters();
    });
    this.elements.filtersForm.addEventListener('reset', () => {
      this.filters = {};
      void this.loadReports();
    });
    this.elements.generateButton.addEventListener('click', () => {
      void this.generateDemoReport();
    });
    this.elements.refreshButton.addEventListener('click', () => {
      void this.loadReports();
    });
  }

  async initialize(): Promise<void> {
    await this.loadReports();
  }

  private async loadReports(): Promise<void> {
    this.setState('loading', 'Loading optimization reports…');

    try {
      const result = await listReports(this.filters);
      this.reports = result.reports;
      this.renderReportList();

      if (this.reports.length === 0) {
        this.setState('empty', 'No reports yet. Run a workflow and generate a report.');
        this.clearDetail();
        return;
      }

      await this.selectReport(this.reports[0].reportId);
      this.setState('success', `${result.total} report(s) loaded.`);
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : 'Failed to load reports.';
      this.setState('error', message);
    }
  }

  private async applyFilters(): Promise<void> {
    const formData = new FormData(this.elements.filtersForm);
    this.filters = {
      status: String(formData.get('status') || '') || undefined,
      resourceType: String(formData.get('resourceType') || '') || undefined,
      confidenceLevel: String(formData.get('confidenceLevel') || '') || undefined,
      verificationStatus: String(formData.get('verificationStatus') || '') || undefined,
    };
    await this.loadReports();
  }

  private async generateDemoReport(): Promise<void> {
    this.setState('loading', 'Running workflow and generating report…');
    this.elements.generateButton.disabled = true;

    try {
      const workflow = await runWorkflow({ plugin: 'ec2', mode: 'full' });
      const { report } = await generateReport(workflow.workflowId);
      await this.loadReports();
      await this.selectReport(report.reportId);
      this.setState('success', `Report ${report.reportId} generated from workflow ${workflow.workflowId}.`);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : 'Report generation failed.';
      this.setState('error', message);
    } finally {
      this.elements.generateButton.disabled = false;
    }
  }

  private async selectReport(reportId: string): Promise<void> {
    try {
      const report = await getReport(reportId);
      this.selectedReport = report;
      this.renderReportDetail(report);
      this.highlightSelected(reportId);
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : 'Failed to load report detail.';
      this.setState('error', message);
    }
  }

  private renderReportList(): void {
    if (this.reports.length === 0) {
      this.elements.reportList.innerHTML = '<p class="empty-note">No reports match the current filters.</p>';
      return;
    }

    this.elements.reportList.innerHTML = `
      <ul class="report-list" role="list">
        ${this.reports
          .map(
            (report) => `
          <li>
            <button type="button" class="report-list-item" data-report-id="${report.reportId}">
              <span class="report-list-title">${report.summary.headline}</span>
              <span class="report-list-meta">${report.reportId} · ${report.status} · ${report.summary.opportunityCount} opp.</span>
            </button>
          </li>
        `
          )
          .join('')}
      </ul>
    `;

    for (const button of this.elements.reportList.querySelectorAll<HTMLButtonElement>('.report-list-item')) {
      button.addEventListener('click', () => {
        const reportId = button.dataset.reportId;
        if (reportId) {
          void this.selectReport(reportId);
        }
      });
    }
  }

  private highlightSelected(reportId: string): void {
    for (const button of this.elements.reportList.querySelectorAll<HTMLButtonElement>('.report-list-item')) {
      button.classList.toggle('active', button.dataset.reportId === reportId);
    }
  }

  private renderReportDetail(report: OptimizationReport): void {
    renderReportSummaryCard(this.elements.summaryPanel, report.summary);
    renderSavingsSummaryCard(this.elements.savingsPanel, report.financialImpact);
    renderRecommendationSummary(this.elements.recommendationPanel, report.recommendations);
    renderVerificationSummary(this.elements.verificationPanel, report.verification);

    this.elements.reportDetail.innerHTML = `
      <section class="dashboard-card report-meta-card">
        <h3 class="card-title">Report Details</h3>
        <dl class="detail-grid">
          <div><dt>Report ID</dt><dd>${report.reportId}</dd></div>
          <div><dt>Workflow</dt><dd>${report.workflowId}</dd></div>
          <div><dt>Plugin</dt><dd>${report.plugin}</dd></div>
          <div><dt>Region</dt><dd>${report.region}</dd></div>
          <div><dt>Status</dt><dd>${report.status}</dd></div>
          <div><dt>Created</dt><dd>${new Date(report.createdAt).toLocaleString()}</dd></div>
        </dl>
        <p class="technical-summary"><strong>Technical:</strong> ${report.summary.technicalSummary ?? 'N/A'}</p>
        <div class="export-options">
          <h4>Export Options</h4>
          <ul>${report.exportOptions.map((opt) => `<li>${opt.format.toUpperCase()} — ${opt.available ? 'Available' : 'Future'}: ${opt.description}</li>`).join('')}</ul>
        </div>
      </section>
    `;
  }

  private clearDetail(): void {
    this.selectedReport = null;
    const empty = '<p class="empty-note">Select or generate a report.</p>';
    this.elements.reportDetail.innerHTML = empty;
    this.elements.summaryPanel.innerHTML = empty;
    this.elements.savingsPanel.innerHTML = empty;
    this.elements.recommendationPanel.innerHTML = empty;
    this.elements.verificationPanel.innerHTML = empty;
  }

  private setState(state: DashboardState, message?: string): void {
    this.state = state;
    renderStateMessage(this.elements.stateMessage, { state, message });
  }

  getState(): DashboardState {
    return this.state;
  }

  getSelectedReport(): OptimizationReport | null {
    return this.selectedReport;
  }
}
