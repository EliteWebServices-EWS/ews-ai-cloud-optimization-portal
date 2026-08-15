/**
 * EC2RightsizingCard — shows under-utilized EC2 instances and recommended replacements.
 */

import { escapeHtml, formatCurrency } from '../utils/format';
import type { Ec2RightsizingOpportunity } from '../types';

export function formatRightsizingUtilization(utilization: number | undefined): string {
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) {
    return 'Utilization not analyzed';
  }
  return `${utilization}% utilization`;
}

export function formatRightsizingSavings(savings: number | undefined): string {
  if (typeof savings !== 'number' || !Number.isFinite(savings)) {
    return 'Savings unavailable';
  }
  return `${formatCurrency(savings)}/mo`;
}

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
          <small>${escapeHtml(formatRightsizingUtilization(opportunity.utilization))} · ${escapeHtml(formatRightsizingSavings(opportunity.savings))}</small>
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
