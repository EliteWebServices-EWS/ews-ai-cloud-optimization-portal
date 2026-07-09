/**
 * FinancialImpactCard — displays cost and savings from Financial Engine.
 */

import { escapeHtml, formatCurrency, formatPercent } from '../utils/format';
import type { FinancialImpact } from '../types';

export function renderFinancialImpactCard(
  container: HTMLElement,
  financial?: FinancialImpact
): void {
  if (!financial) {
    container.innerHTML = '<p class="empty-note">Financial impact not yet calculated.</p>';
    return;
  }

  container.innerHTML = `
    <section class="dashboard-card financial-card" aria-labelledby="financial-heading">
      <h3 id="financial-heading" class="card-title">Financial Impact</h3>
      <span class="${escapeHtml('status-badge status-' + financial.status.toLowerCase())}">${escapeHtml(financial.status)}</span>
      <dl class="financial-grid">
        <div><dt>Current Monthly Cost</dt><dd>${escapeHtml(formatCurrency(financial.currentMonthlyCost, financial.currency))}</dd></div>
        <div><dt>Projected Cost</dt><dd>${escapeHtml(formatCurrency(financial.projectedMonthlyCost, financial.currency))}</dd></div>
        <div class="savings"><dt>Monthly Savings</dt><dd>${escapeHtml(formatCurrency(financial.monthlySavings, financial.currency))}</dd></div>
        <div class="savings"><dt>Annual Savings</dt><dd>${escapeHtml(formatCurrency(financial.annualSavings, financial.currency))}</dd></div>
        <div><dt>Reduction</dt><dd>${escapeHtml(formatPercent(financial.percentageReduction))}</dd></div>
      </dl>
    </section>
  `;
}
