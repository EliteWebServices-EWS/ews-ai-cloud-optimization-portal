/**
 * EC2ExecutiveSummaryCard — renders the leadership-ready summary for EC2 optimization.
 */

import { escapeHtml, formatCurrency } from '../utils/format';
import { SAVINGS_UNAVAILABLE_LABEL } from '../ec2/ec2-dashboard-view-model';
import type { Ec2ExecutiveSummary } from '../types';

function formatProjectedSavings(summary: Ec2ExecutiveSummary): string {
  if (summary.savingsUnavailable) {
    return SAVINGS_UNAVAILABLE_LABEL;
  }
  if (typeof summary.savings !== 'number' || !Number.isFinite(summary.savings)) {
    return SAVINGS_UNAVAILABLE_LABEL;
  }
  return formatCurrency(summary.savings);
}

export function renderEc2ExecutiveSummaryCard(
  container: HTMLElement,
  summary: Ec2ExecutiveSummary
): void {
  const complianceDisplay =
    summary.confidence > 0
      ? `${summary.confidence}%`
      : summary.securityRisk.includes('no EC2 instances')
        ? 'Not applicable (no instances in scope)'
        : 'Not yet assessed';

  container.innerHTML = `
    <section class="dashboard-card" aria-labelledby="ec2-executive-heading">
      <h3 id="ec2-executive-heading" class="card-title">Executive Summary</h3>
      <span class="status-badge status-${escapeHtml(summary.priority.toLowerCase())}">${escapeHtml(summary.priority)}</span>
      <p class="report-headline">${escapeHtml(summary.title)}</p>
      <p class="report-executive">${escapeHtml(summary.headline)}</p>
      <dl class="report-summary-grid">
        <div><dt>Projected Savings</dt><dd>${escapeHtml(formatProjectedSavings(summary))}</dd></div>
        <div><dt>Security Risk</dt><dd>${escapeHtml(summary.securityRisk)}</dd></div>
        <div><dt>Compliance score</dt><dd>${escapeHtml(complianceDisplay)}</dd></div>
      </dl>
    </section>
  `;
}
