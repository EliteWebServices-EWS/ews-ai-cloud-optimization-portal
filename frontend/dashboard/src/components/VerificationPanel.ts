/**
 * VerificationPanel — displays execution and verification outcomes.
 */

import { escapeHtml, formatCurrency, statusClass } from '../utils/format';
import type { ExecutionResult, VerificationResult } from '../types';

export interface VerificationPanelData {
  execution?: ExecutionResult;
  verification?: VerificationResult;
  reportSummary?: string;
}

export function renderVerificationPanel(
  container: HTMLElement,
  data: VerificationPanelData
): void {
  const { execution, verification, reportSummary } = data;

  if (!execution && !verification) {
    container.innerHTML = '<p class="empty-note">Verification pending execution.</p>';
    return;
  }

  container.innerHTML = `
    <section class="dashboard-card verification-card" aria-labelledby="verification-heading">
      <h3 id="verification-heading" class="card-title">Verification Result</h3>
      ${execution ? `
        <div class="verification-row">
          <span class="label">Execution</span>
          <span class="${statusClass(execution.status)}">${escapeHtml(execution.status)}</span>
          ${execution.change ? `<span class="card-meta">${escapeHtml(execution.change.from)} → ${escapeHtml(execution.change.to)}</span>` : ''}
        </div>
      ` : ''}
      ${verification ? `
        <div class="verification-row">
          <span class="label">Verification</span>
          <span class="${statusClass(verification.status)}">${escapeHtml(verification.status)}</span>
        </div>
        <dl class="detail-list">
          <div><dt>Expected Savings</dt><dd>${escapeHtml(formatCurrency(verification.expectedSavings))}</dd></div>
          <div><dt>Verified Savings</dt><dd class="highlight">${escapeHtml(formatCurrency(verification.verifiedSavings))}</dd></div>
          <div><dt>Variance</dt><dd>${escapeHtml(formatCurrency(verification.variance))} (${verification.variancePercentage.toFixed(1)}%)</dd></div>
          <div><dt>State Matched</dt><dd>${verification.stateMatched ? 'Yes' : 'No'}</dd></div>
        </dl>
        ${verification.message ? `<p class="card-summary">${escapeHtml(verification.message)}</p>` : ''}
      ` : ''}
      ${reportSummary ? `<p class="card-meta">${escapeHtml(reportSummary)}</p>` : ''}
    </section>
  `;
}
