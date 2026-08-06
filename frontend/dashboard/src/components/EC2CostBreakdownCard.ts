/**
 * EC2CostBreakdownCard — shows the EC2 cost mix and savings opportunity.
 */

import { escapeHtml, formatCurrency } from '../utils/format';
import type { Ec2CostBreakdown } from '../types';

export function renderEc2CostBreakdownCard(
  container: HTMLElement,
  breakdown: Ec2CostBreakdown
): void {
  const total = breakdown.currentMonthlyCost;
  const showDetails = breakdown.showBreakdownDetails !== false && total > 0;
  const computeShare = showDetails ? (breakdown.computeCost / total) * 100 : 0;
  const storageShare = showDetails ? (breakdown.storageCost / total) * 100 : 0;
  const networkShare = showDetails ? (breakdown.networkCost / total) * 100 : 0;
  const otherShare = showDetails ? (breakdown.otherCost / total) * 100 : 0;

  const breakdownHtml = showDetails
    ? `
      <ul class="breakdown-list">
        <li><span>Compute</span><strong>${escapeHtml(formatCurrency(breakdown.computeCost))}</strong><em>${computeShare.toFixed(0)}%</em></li>
        <li><span>Storage</span><strong>${escapeHtml(formatCurrency(breakdown.storageCost))}</strong><em>${storageShare.toFixed(0)}%</em></li>
        <li><span>Network</span><strong>${escapeHtml(formatCurrency(breakdown.networkCost))}</strong><em>${networkShare.toFixed(0)}%</em></li>
        <li><span>Other</span><strong>${escapeHtml(formatCurrency(breakdown.otherCost))}</strong><em>${otherShare.toFixed(0)}%</em></li>
      </ul>`
    : '<p class="empty-note">No live monthly cost breakdown available for this account.</p>';

  const savingsNote = breakdown.savingsLabel
    ? `<p class="metric-note">${escapeHtml(breakdown.savingsLabel)}</p>`
    : '';

  container.innerHTML = `
    <section class="dashboard-card" aria-labelledby="ec2-cost-heading">
      <h3 id="ec2-cost-heading" class="card-title">Cost Breakdown</h3>
      <div class="metric-grid compact">
        <article class="metric-card">
          <h4>Current Monthly</h4>
          <div class="metric-value">${escapeHtml(formatCurrency(breakdown.currentMonthlyCost))}</div>
        </article>
        <article class="metric-card">
          <h4>Estimated Savings</h4>
          <div class="metric-value">${escapeHtml(formatCurrency(breakdown.estimatedSavings))}</div>
        </article>
      </div>
      ${savingsNote}
      ${breakdownHtml}
    </section>
  `;
}
