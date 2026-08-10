/**
 * Reports Page — displays optimization reports from the Reporting Engine.
 * Presentation layer only; all data sourced from backend API.
 */

import { generateReport, getReport, listReports } from '../api/reportApi';
import { checkHealth, runWorkflow } from '../api/workflowApi';
import { renderRecommendationSummary } from '../components/RecommendationSummary';
import { renderReportSummaryCard } from '../components/ReportSummaryCard';
import { renderSavingsSummaryCard } from '../components/SavingsSummaryCard';
import { renderStateMessage } from '../components/StateMessage';
import { renderVerificationSummary } from '../components/VerificationSummary';
import type { DashboardState, OptimizationReport, ReportFilterParams, ReportListItem } from '../types';
import { ApiClientError } from '../api/client';
import { consumeEc2AsyncJobCompletedSignal } from '../ec2-async-job/ec2-async-job-freshness';
import {
  buildReportJsonFilename,
  downloadOptimizationReportJson,
} from '../utils/report-json-export';
import {
  compareReportsNewestFirst,
  formatLatestHistorySummary,
  pickLatestEc2ReportsByScope,
} from '../ec2-async-job/ec2-analysis-scope';

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

/** Live customer Reports page — only completed live EC2 async intelligence reports. */
const LIVE_REPORTS_SOURCE = 'ec2_async';

export class ReportsPage {
  private state: DashboardState = 'idle';
  private reports: ReportListItem[] = [];
  private reportHistoryExpanded = false;
  private selectedReport: OptimizationReport | null = null;
  private filters: ReportFilterParams = { reportSource: LIVE_REPORTS_SOURCE };
  private workflowDemoReportsEnabled = false;

  constructor(private readonly elements: ReportsPageElements) {
    this.elements.filtersForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.applyFilters();
    });
    this.elements.filtersForm.addEventListener('reset', () => {
      this.filters = { reportSource: LIVE_REPORTS_SOURCE };
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
    await this.loadDemoGenerationFeature();
    const ec2Completed = consumeEc2AsyncJobCompletedSignal();
    await this.loadReports(ec2Completed?.jobId);
    if (ec2Completed && this.state !== 'error') {
      this.setState(
        'success',
        `EC2 analysis completed (${ec2Completed.jobId.slice(0, 8)}…). Report list loaded from the Reporting Engine.`,
      );
    }
  }

  private async loadReports(preferEc2AsyncJobId?: string): Promise<void> {
    this.setState('loading', 'Loading optimization reports…');

    try {
      const result = await listReports(this.filters);
      this.reports = [...result.reports].sort(compareReportsNewestFirst);
      this.renderReportList();

      if (this.reports.length === 0) {
        this.setState(
          'empty',
          'No live EC2 async reports yet. Run EC2 analysis from the Decision Dashboard for a connected AWS account.',
        );
        this.clearDetail();
        return;
      }

      await this.selectReport(this.resolveDefaultReportId(preferEc2AsyncJobId));
      this.setState('success', this.buildReportCountMessage(result.total));
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : 'Failed to load reports.';
      this.setState('error', message);
    }
  }

  private async loadDemoGenerationFeature(): Promise<void> {
    try {
      const health = await checkHealth();
      this.workflowDemoReportsEnabled = health.features?.workflowDemoReports === true;
    } catch {
      this.workflowDemoReportsEnabled = false;
    }
    this.elements.generateButton.hidden = !this.workflowDemoReportsEnabled;
    this.elements.generateButton.disabled = !this.workflowDemoReportsEnabled;
  }

  private async applyFilters(): Promise<void> {
    const formData = new FormData(this.elements.filtersForm);
    this.filters = {
      reportSource: LIVE_REPORTS_SOURCE,
      status: String(formData.get('status') || '') || undefined,
      resourceType: String(formData.get('resourceType') || '') || undefined,
      confidenceLevel: String(formData.get('confidenceLevel') || '') || undefined,
      verificationStatus: String(formData.get('verificationStatus') || '') || undefined,
    };
    await this.loadReports();
  }

  private async generateDemoReport(): Promise<void> {
    if (!this.workflowDemoReportsEnabled) {
      this.setState('error', 'Demo report generation is not enabled in this environment.');
      return;
    }
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

  private getVisibleReports(): ReportListItem[] {
    if (this.reportHistoryExpanded) {
      return this.reports;
    }
    return pickLatestEc2ReportsByScope(this.reports);
  }

  private buildReportCountMessage(totalFromApi: number): string {
    const total = this.reports.length;
    const visible = this.getVisibleReports().length;
    if (total === 0) {
      return '';
    }
    if (total === visible) {
      return `${totalFromApi} live EC2 report${totalFromApi === 1 ? '' : 's'} loaded.`;
    }
    return formatLatestHistorySummary({
      visibleLatestCount: visible,
      totalCount: total,
      noun: 'report',
    });
  }

  private renderReportList(): void {
    const visibleReports = this.getVisibleReports();
    if (visibleReports.length === 0) {
      this.elements.reportList.innerHTML = '<p class="empty-note">No reports match the current filters.</p>';
      return;
    }

    const latestCount = pickLatestEc2ReportsByScope(this.reports).length;
    const hiddenOlder = Math.max(0, this.reports.length - latestCount);
    const historyToggle =
      hiddenOlder > 0
        ? `<button type="button" class="btn-secondary" id="report-history-toggle" aria-expanded="${this.reportHistoryExpanded ? 'true' : 'false'}" aria-controls="report-list-items">${
            this.reportHistoryExpanded
              ? 'Hide report history'
              : `Show report history (${hiddenOlder})`
          }</button>`
        : '';
    const summary =
      this.reports.length > latestCount
        ? `<p class="report-history-summary">${formatLatestHistorySummary({
            visibleLatestCount: latestCount,
            totalCount: this.reports.length,
            noun: 'report',
          })}</p>`
        : '';

    this.elements.reportList.innerHTML = `
      ${summary}
      ${historyToggle}
      <ul class="report-list" id="report-list-items" role="list">
        ${visibleReports
          .map(
            (report) => `
          <li>
            <button type="button" class="report-list-item" data-report-id="${report.reportId}">
              <span class="report-list-title">${report.summary.headline}</span>
              <span class="report-list-meta">${report.reportId} · ${this.formatReportSource(report)} · ${report.status} · ${new Date(report.createdAt).toLocaleString()} · ${report.summary.opportunityCount} opp.</span>
            </button>
          </li>
        `,
          )
          .join('')}
      </ul>
    `;

    const toggleBtn = this.elements.reportList.querySelector('#report-history-toggle');
    toggleBtn?.addEventListener('click', () => {
      this.reportHistoryExpanded = !this.reportHistoryExpanded;
      this.renderReportList();
      this.highlightSelected(this.selectedReport?.reportId ?? '');
      this.setState('success', this.buildReportCountMessage(this.reports.length));
    });

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
          <div><dt>Source</dt><dd>${this.formatReportSourceDetail(report)}</dd></div>
          <div><dt>Workflow</dt><dd>${report.workflowId}</dd></div>
          <div><dt>Plugin</dt><dd>${report.plugin}</dd></div>
          <div><dt>Region</dt><dd>${report.region}</dd></div>
          <div><dt>Status</dt><dd>${report.status}</dd></div>
          <div><dt>Created</dt><dd>${new Date(report.createdAt).toLocaleString()}</dd></div>
        </dl>
        <p class="technical-summary"><strong>Technical:</strong> ${report.summary.technicalSummary ?? 'N/A'}</p>
        <div class="export-options">
          <h4>Export Options</h4>
          <ul>${this.renderExportOptionsList(report)}</ul>
          ${this.renderJsonExportAction(report)}
        </div>
      </section>
    `;

    const exportButton = this.elements.reportDetail.querySelector<HTMLButtonElement>(
      '[data-export-json]',
    );
    exportButton?.addEventListener('click', () => {
      if (this.selectedReport?.reportId === report.reportId) {
        downloadOptimizationReportJson(this.selectedReport);
      }
    });
  }

  private renderExportOptionsList(report: OptimizationReport): string {
    return report.exportOptions
      .map((opt) => {
        const status = opt.available ? 'Available' : 'Planned / Future';
        return `<li>${opt.format.toUpperCase()} — ${status}: ${opt.description}</li>`;
      })
      .join('');
  }

  private renderJsonExportAction(report: OptimizationReport): string {
    const jsonOption = report.exportOptions.find((opt) => opt.format === 'json');
    if (!jsonOption?.available) {
      return '';
    }
    return `<button type="button" class="btn-secondary" data-export-json>Download JSON (${buildReportJsonFilename(report.reportId)})</button>`;
  }

  private clearDetail(): void {
    this.selectedReport = null;
    const emptyMessage = '<p class="empty-note">Select a report from the list to view details.</p>';
    this.elements.reportDetail.innerHTML = emptyMessage;
    for (const panel of [
      this.elements.summaryPanel,
      this.elements.savingsPanel,
      this.elements.recommendationPanel,
      this.elements.verificationPanel,
    ]) {
      panel.replaceChildren();
    }
  }

  private resolveDefaultReportId(preferEc2AsyncJobId?: string): string {
    if (preferEc2AsyncJobId) {
      const match = this.reports.find(
        (report) =>
          report.ec2AsyncJobId === preferEc2AsyncJobId ||
          report.workflowId === `ec2-async:${preferEc2AsyncJobId}`,
      );
      if (match) {
        return match.reportId;
      }
    }

    const visible = this.getVisibleReports();
    return visible[0]?.reportId ?? this.reports[0]!.reportId;
  }

  private formatReportSource(report: ReportListItem): string {
    switch (report.reportSource) {
      case 'ec2_async':
        return 'Live EC2 async';
      case 'demo':
        return 'Demo workflow';
      case 'workflow':
        return 'Workflow';
      default:
        return 'Legacy workflow';
    }
  }

  private formatReportSourceDetail(report: OptimizationReport): string {
    switch (report.reportSource) {
      case 'ec2_async':
        return `Live EC2 async analysis${report.ec2AsyncJobId ? ` (${report.ec2AsyncJobId})` : ''}`;
      case 'demo':
        return 'Demo workflow (mock provider)';
      case 'workflow':
        return 'Workflow report';
      default:
        return 'Legacy workflow report';
    }
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

  isWorkflowDemoReportsEnabled(): boolean {
    return this.workflowDemoReportsEnabled;
  }

  isReportHistoryExpanded(): boolean {
    return this.reportHistoryExpanded;
  }

  getVisibleReportCount(): number {
    return this.getVisibleReports().length;
  }

  getTotalReportCount(): number {
    return this.reports.length;
  }
}
