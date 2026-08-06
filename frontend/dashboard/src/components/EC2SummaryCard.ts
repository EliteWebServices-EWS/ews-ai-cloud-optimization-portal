/**
 * EC2SummaryCard — renders the first EC2 dashboard summary card for the request.
 */

import { escapeHtml, formatCurrency } from '../utils/format';
import type { Ec2DashboardSummary } from '../types';

export function renderEc2SummaryCard(
  container: HTMLElement,
  summary: Ec2DashboardSummary
): void {
  const recommendationHtml = summary.recommendations.length
    ? summary.recommendations
        .map(
          (recommendation) => `
          <li>
            <strong>${escapeHtml(recommendation.title)}</strong>
            <span class="chip chip-${escapeHtml(recommendation.category)}">${escapeHtml(recommendation.category)}</span>
            <small>${escapeHtml(recommendation.priority)} priority · ${escapeHtml(recommendation.impact)}</small>
            <p>${escapeHtml(recommendation.detail)}</p>
          </li>
        `
        )
        .join('')
    : '<li class="empty-note">No active EC2 recommendations.</li>';

  container.innerHTML = `
    <section class="dashboard-card ec2-summary-card" aria-labelledby="ec2-summary-heading">
      <h3 id="ec2-summary-heading" class="card-title">EC2 Summary</h3>
      <div class="ec2-summary-grid">
        <div>
          <p class="label">Region</p>
          <div class="metric-value small">${escapeHtml(summary.region)}</div>
        </div>
        <div>
          <p class="label">Instances</p>
          <div class="metric-value small">${summary.totalInstances}</div>
        </div>
        <div>
          <p class="label">Running</p>
          <div class="metric-value small">${summary.runningInstances}</div>
        </div>
        <div>
          <p class="label">Stopped</p>
          <div class="metric-value small">${summary.stoppedInstances}</div>
        </div>
      </div>

      <dl class="detail-list compact">
        <div><dt>Monthly Cost</dt><dd>${escapeHtml(formatCurrency(summary.monthlyCost))}</dd></div>
        <div><dt>Avg CPU</dt><dd>${summary.averageCpuUtilization.toFixed(1)}%</dd></div>
        <div><dt>Rightsizing</dt><dd>${summary.rightsizingOpportunities} opportunities</dd></div>
        <div><dt>Security</dt><dd>${summary.securityFindings} findings</dd></div>
        <div><dt>Governance</dt><dd>${summary.governanceScore}/100</dd></div>
      </dl>

      <div class="recommendation-list compact">
        <h4>Priority actions</h4>
        <ul>${recommendationHtml}</ul>
      </div>
    </section>
  `;
}
