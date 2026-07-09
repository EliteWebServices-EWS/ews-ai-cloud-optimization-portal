/**
 * ReportSummaryCard — displays executive report summary from Reporting Engine.
 */

import { escapeHtml, formatCurrency } from '../utils/format';
import type { ReportSummaryView } from '../types';

export function renderReportSummaryCard(
  container: HTMLElement,
  summary?: ReportSummaryView
): void {
  if (!summary) {
    container.innerHTML = '<p class="empty-note">No report summary available.</p>';
    return;
  }

  container.innerHTML = `
    <section class="dashboard-card report-summary-card" aria-labelledby="report-summary-heading">
      <h3 id="report-summary-heading" class="card-title">Executive Summary</h3>
      <span class="${escapeHtml('status-badge status-' + summary.optimizationStatus)}">${escapeHtml(summary.optimizationStatus)}</span>
      <p class="report-headline">${escapeHtml(summary.headline)}</p>
      <p class="report-executive">${escapeHtml(summary.executiveSummary)}</p>
      <dl class="report-summary-grid">
        <div><dt>Opportunities</dt><dd>${summary.opportunityCount}</dd></div>
        <div><dt>Estimated Savings</dt><dd>${escapeHtml(formatCurrency(summary.estimatedMonthlySavings, summary.currency))}/mo</dd></div>
        <div><dt>Verified Savings</dt><dd>${escapeHtml(formatCurrency(summary.verifiedMonthlySavings, summary.currency))}/mo</dd></div>
        <div><dt>Verified</dt><dd>${summary.verifiedCount}</dd></div>
      </dl>
    </section>
  `;
}
