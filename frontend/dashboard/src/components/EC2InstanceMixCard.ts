/**
 * EC2InstanceMixCard — shows EC2 family distribution and cost mix.
 */

import { escapeHtml, formatCurrency } from '../utils/format';
import type { Ec2InstanceMix } from '../types';

export function renderEc2InstanceMixCard(
  container: HTMLElement,
  mix: Ec2InstanceMix
): void {
  const rows = mix.byFamily
    .map((entry) => {
      const costHtml =
        entry.monthlyCostUnavailable === false &&
        typeof entry.monthlyCost === 'number' &&
        Number.isFinite(entry.monthlyCost)
          ? `<strong>${escapeHtml(formatCurrency(entry.monthlyCost))}</strong>`
          : '';
      return `
        <li>
          <span class="family-name">${escapeHtml(entry.family)}</span>
          <span class="family-share">${entry.share}%</span>
          ${costHtml}
        </li>
      `;
    })
    .join('');

  container.innerHTML = `
    <section class="dashboard-card" aria-labelledby="ec2-mix-heading">
      <h3 id="ec2-mix-heading" class="card-title">Instance Mix</h3>
      <p class="metric-note">${mix.total} total EC2 instances</p>
      <ul class="instance-mix-list">
        ${rows}
      </ul>
    </section>
  `;
}
