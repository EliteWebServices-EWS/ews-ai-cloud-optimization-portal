/**
 * RecommendationSummary — displays recommendation decisions from reports.
 */

import { escapeHtml } from '../utils/format';
import type { ReportRecommendationView } from '../types';

export function renderRecommendationSummary(
  container: HTMLElement,
  recommendations: ReportRecommendationView[] = []
): void {
  if (recommendations.length === 0) {
    container.innerHTML = '<p class="empty-note">No recommendations in this report.</p>';
    return;
  }

  const items = recommendations
    .map(
      (entry) => `
      <article class="recommendation-entry">
        <header>
          <strong>${escapeHtml(entry.resourceId)}</strong>
          <span class="${escapeHtml('status-badge status-' + entry.decision.recommendationStatus.toLowerCase())}">${escapeHtml(entry.decision.recommendationStatus)}</span>
        </header>
        <p>${escapeHtml(entry.decision.summary)}</p>
        <dl class="detail-grid">
          <div><dt>Confidence</dt><dd>${entry.decision.confidenceScore}% (${escapeHtml(entry.decision.confidenceStatus)})</dd></div>
          <div><dt>Governance</dt><dd>${escapeHtml(entry.decision.governanceDecision)}</dd></div>
          ${
            entry.decision.fromInstanceType && entry.decision.toInstanceType
              ? `<div><dt>Change</dt><dd>${escapeHtml(entry.decision.fromInstanceType)} → ${escapeHtml(entry.decision.toInstanceType)}</dd></div>`
              : ''
          }
        </dl>
        <p class="reason-text">${escapeHtml(entry.decision.reason)}</p>
      </article>
    `
    )
    .join('');

  container.innerHTML = `
    <section class="dashboard-card recommendation-summary-card" aria-labelledby="recommendation-summary-heading">
      <h3 id="recommendation-summary-heading" class="card-title">Recommendations</h3>
      <div class="recommendation-list">${items}</div>
    </section>
  `;
}
