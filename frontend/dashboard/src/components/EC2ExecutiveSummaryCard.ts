/**
 * EC2ExecutiveSummaryCard — renders the leadership-ready summary for EC2 optimization.
 */

import { escapeHtml, formatCurrency } from '../utils/format';
import type { Ec2ExecutiveSummary } from '../types';

export function renderEc2ExecutiveSummaryCard(
  container: HTMLElement,
  summary: Ec2ExecutiveSummary
): void {
  const confidenceDisplay =
    summary.confidence > 0 ? `${summary.confidence}%` : 'Not analyzed';

  container.innerHTML = `
    <section class="dashboard-card" aria-labelledby="ec2-executive-heading">
      <h3 id="ec2-executive-heading" class="card-title">Executive Summary</h3>
      <span class="status-badge status-${escapeHtml(summary.priority.toLowerCase())}">${escapeHtml(summary.priority)}</span>
      <p class="report-headline">${escapeHtml(summary.title)}</p>
      <p class="report-executive">${escapeHtml(summary.headline)}</p>
      <dl class="report-summary-grid">
        <div><dt>Projected Savings</dt><dd>${escapeHtml(formatCurrency(summary.savings))}</dd></div>
        <div><dt>Security Risk</dt><dd>${escapeHtml(summary.securityRisk)}</dd></div>
        <div><dt>Confidence</dt><dd>${confidenceDisplay}</dd></div>
      </dl>
    </section>
  `;
}
