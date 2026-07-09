/**
 * ConfidenceIndicator — displays confidence score and explanation.
 */

import { escapeHtml } from '../utils/format';
import type { ConfidenceResult } from '../types';

export function renderConfidenceIndicator(
  container: HTMLElement,
  confidence?: ConfidenceResult
): void {
  if (!confidence) {
    container.innerHTML = '<p class="empty-note">Confidence analysis pending.</p>';
    return;
  }

  const level = confidence.status;
  const factors = confidence.factors
    ?.map((f) => `<li><strong>${escapeHtml(f.name)}</strong>: ${escapeHtml(f.detail)} (${f.score})</li>`)
    .join('') ?? '';

  container.innerHTML = `
    <section class="dashboard-card" aria-labelledby="confidence-heading">
      <h3 id="confidence-heading" class="card-title">Confidence Intelligence</h3>
      <div class="confidence-display">
        <span class="confidence-level level-${escapeHtml(level.toLowerCase())}">${escapeHtml(level)}</span>
        <span class="confidence-score">${confidence.score}%</span>
      </div>
      <p class="card-summary">"${escapeHtml(confidence.reason)}"</p>
      ${factors ? `<ul class="factor-list">${factors}</ul>` : ''}
    </section>
  `;
}
