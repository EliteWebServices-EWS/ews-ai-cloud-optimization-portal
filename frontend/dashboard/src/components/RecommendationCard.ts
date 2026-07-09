/**
 * RecommendationCard — displays recommendation decision from backend.
 */

import { escapeHtml, statusClass } from '../utils/format';
import type { RecommendationDecision } from '../types';

export function renderRecommendationCard(
  container: HTMLElement,
  recommendation?: RecommendationDecision
): void {
  if (!recommendation) {
    container.innerHTML = '<p class="empty-note">No recommendation generated yet.</p>';
    return;
  }

  const explanation = recommendation.explanation;

  container.innerHTML = `
    <section class="dashboard-card recommendation-card" aria-labelledby="recommendation-heading">
      <h3 id="recommendation-heading" class="card-title">Recommendation</h3>
      <span class="${statusClass(recommendation.status)}">${escapeHtml(recommendation.status)}</span>
      <p class="recommendation-summary">${escapeHtml(recommendation.summary)}</p>
      <p class="card-summary">${escapeHtml(recommendation.reason)}</p>
      ${recommendation.detail ? `
        <dl class="detail-list">
          <div><dt>Action</dt><dd>${escapeHtml(recommendation.detail.action)}</dd></div>
          <div><dt>From</dt><dd><code>${escapeHtml(recommendation.detail.fromInstanceType)}</code></dd></div>
          <div><dt>To</dt><dd><code class="highlight">${escapeHtml(recommendation.detail.toInstanceType)}</code></dd></div>
        </dl>
      ` : ''}
      ${explanation ? `
        <div class="explanation-block">
          <p><strong>Governance:</strong> ${escapeHtml(explanation.governance)}</p>
          <p><strong>Financial:</strong> ${escapeHtml(explanation.financial)}</p>
          <p><strong>Confidence:</strong> ${escapeHtml(explanation.confidence)}</p>
        </div>
      ` : ''}
    </section>
  `;
}
