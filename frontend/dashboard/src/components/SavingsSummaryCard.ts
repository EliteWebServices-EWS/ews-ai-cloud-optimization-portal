/**
 * SavingsSummaryCard — displays aggregated savings from optimization reports.
 */

import { escapeHtml, formatCurrency, formatPercent } from '../utils/format';
import type { SavingsSummaryView } from '../types';

export function renderSavingsSummaryCard(
  container: HTMLElement,
  savings?: SavingsSummaryView
): void {
  if (!savings) {
    container.innerHTML = '<p class="empty-note">Savings data not available.</p>';
    return;
  }

  container.innerHTML = `
    <section class="dashboard-card savings-summary-card" aria-labelledby="savings-summary-heading">
      <h3 id="savings-summary-heading" class="card-title">Savings Summary</h3>
      <span class="${escapeHtml('status-badge status-' + savings.status.toLowerCase())}">${escapeHtml(savings.status)}</span>
      <dl class="financial-grid">
        <div><dt>Current Monthly Cost</dt><dd>${escapeHtml(formatCurrency(savings.currentMonthlyCost, savings.currency))}</dd></div>
        <div><dt>Projected Cost</dt><dd>${escapeHtml(formatCurrency(savings.projectedMonthlyCost, savings.currency))}</dd></div>
        <div class="savings"><dt>Estimated Monthly</dt><dd>${escapeHtml(formatCurrency(savings.estimatedMonthlySavings, savings.currency))}</dd></div>
        <div class="savings"><dt>Estimated Annual</dt><dd>${escapeHtml(formatCurrency(savings.estimatedAnnualSavings, savings.currency))}</dd></div>
        <div class="savings"><dt>Verified Monthly</dt><dd>${escapeHtml(formatCurrency(savings.verifiedMonthlySavings, savings.currency))}</dd></div>
        <div><dt>Reduction</dt><dd>${escapeHtml(formatPercent(savings.percentageReduction))}</dd></div>
      </dl>
    </section>
  `;
}
