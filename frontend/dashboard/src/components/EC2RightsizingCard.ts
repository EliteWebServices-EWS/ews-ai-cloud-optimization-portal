/**
 * EC2RightsizingCard — shows under-utilized EC2 instances and recommended replacements.
 */

import { escapeHtml, formatCurrency } from '../utils/format';
import type { Ec2RightsizingOpportunity } from '../types';

export function renderEc2RightsizingCard(
  container: HTMLElement,
  opportunities: Ec2RightsizingOpportunity[] = []
): void {
  if (opportunities.length === 0) {
    container.innerHTML = '<p class="empty-note">No rightsizing opportunities identified.</p>';
    return;
  }

  const items = opportunities
    .map(
      (opportunity) => `
        <li>
          <strong>${escapeHtml(opportunity.instanceId)}</strong>
          <span>${escapeHtml(opportunity.currentType)} → ${escapeHtml(opportunity.recommendedType)}</span>
          <small>${opportunity.utilization}% utilization · ${escapeHtml(formatCurrency(opportunity.savings))}/mo</small>
        </li>
      `
    )
    .join('');

  container.innerHTML = `
    <section class="dashboard-card" aria-labelledby="ec2-rightsizing-heading">
      <h3 id="ec2-rightsizing-heading" class="card-title">Rightsizing</h3>
      <ul class="rightsizing-list">${items}</ul>
    </section>
  `;
}
