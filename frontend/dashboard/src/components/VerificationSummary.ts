/**
 * VerificationSummary — displays verification outcomes from optimization reports.
 */

import { escapeHtml, formatCurrency } from '../utils/format';
import type { VerificationSummaryView } from '../types';

export function renderVerificationSummary(
  container: HTMLElement,
  verification?: VerificationSummaryView
): void {
  if (!verification) {
    container.innerHTML = '<p class="empty-note">Verification not completed for this report.</p>';
    return;
  }

  container.innerHTML = `
    <section class="dashboard-card verification-summary-card" aria-labelledby="verification-summary-heading">
      <h3 id="verification-summary-heading" class="card-title">Verification Summary</h3>
      <span class="${escapeHtml('status-badge status-' + verification.status)}">${escapeHtml(verification.status)}</span>
      <dl class="detail-grid">
        <div><dt>Expected Savings</dt><dd>${escapeHtml(formatCurrency(verification.expectedSavings))}</dd></div>
        <div><dt>Actual Savings</dt><dd>${escapeHtml(formatCurrency(verification.actualSavings))}</dd></div>
        <div><dt>Verified Savings</dt><dd>${escapeHtml(formatCurrency(verification.verifiedSavings))}</dd></div>
        <div><dt>Variance</dt><dd>${escapeHtml(formatCurrency(verification.variance))} (${verification.variancePercentage.toFixed(1)}%)</dd></div>
        <div><dt>State Matched</dt><dd>${verification.stateMatched ? 'Yes' : 'No'}</dd></div>
      </dl>
      ${verification.message ? `<p class="reason-text">${escapeHtml(verification.message)}</p>` : ''}
    </section>
  `;
}
