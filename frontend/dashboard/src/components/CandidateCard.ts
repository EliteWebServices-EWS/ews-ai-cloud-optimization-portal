/**
 * CandidateCard — displays optimization candidate configuration.
 */

import { escapeHtml, statusClass } from '../utils/format';
import type { WorkflowDetail } from '../types';

export function renderCandidateCard(container: HTMLElement, detail: WorkflowDetail): void {
  const candidate = detail.candidate;
  const evidence = detail.evidence;
  const recommendation = detail.recommendation;

  if (!candidate) {
    container.innerHTML = '<p class="empty-note">No candidate data available.</p>';
    return;
  }

  const currentType = evidence?.instance?.instanceType ?? 'Unknown';
  const recommendedType =
    recommendation?.detail?.toInstanceType ??
    evidence?.recommendations?.[0]?.target ??
    'Pending analysis';
  const readiness = detail.governance?.readiness?.status ?? detail.governance?.status ?? 'UNKNOWN';

  container.innerHTML = `
    <section class="dashboard-card" aria-labelledby="candidate-heading">
      <h3 id="candidate-heading" class="card-title">Optimization Candidate</h3>
      <div class="candidate-header">
        <span class="resource-type">${escapeHtml(candidate.resourceType.toUpperCase())}</span>
        <span class="${statusClass(readiness)}">${escapeHtml(readiness)}</span>
      </div>
      <dl class="detail-list">
        <div><dt>Resource ID</dt><dd>${escapeHtml(candidate.resourceId)}</dd></div>
        <div><dt>Region</dt><dd>${escapeHtml(candidate.region)}</dd></div>
        <div><dt>Current</dt><dd><code>${escapeHtml(currentType)}</code></dd></div>
        <div><dt>Recommended</dt><dd><code class="highlight">${escapeHtml(recommendedType)}</code></dd></div>
        <div><dt>Environment</dt><dd>${escapeHtml(candidate.tags?.Environment ?? '—')}</dd></div>
      </dl>
    </section>
  `;
}
