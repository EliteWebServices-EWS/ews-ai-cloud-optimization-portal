/**
 * GovernancePanel — displays readiness score and policy evaluation results.
 */

import { escapeHtml, statusClass } from '../utils/format';
import type { GovernanceResult } from '../types';

export function renderGovernancePanel(container: HTMLElement, governance?: GovernanceResult): void {
  if (!governance) {
    container.innerHTML = '<p class="empty-note">Governance evaluation pending.</p>';
    return;
  }

  const passed = governance.policies.filter((p) => p.status === 'PASS');
  const failed = governance.policies.filter((p) => p.status === 'FAIL');
  const warned = governance.policies.filter((p) => p.status === 'WARN');

  const policyRows = governance.policies
    .map(
      (p) => `
      <li class="policy-row policy-${escapeHtml(p.status.toLowerCase())}">
        <span class="policy-name">${escapeHtml(p.name)}</span>
        <span class="policy-status">${escapeHtml(p.status)}</span>
        <span class="policy-reason">${escapeHtml(p.reason)}</span>
      </li>`
    )
    .join('');

  container.innerHTML = `
    <section class="dashboard-card" aria-labelledby="governance-heading">
      <h3 id="governance-heading" class="card-title">Governance Status</h3>
      <div class="governance-score">
        <span class="${statusClass(governance.readiness?.status ?? governance.status)}">${escapeHtml(governance.readiness?.status ?? governance.status)}</span>
        <span class="score-value">${governance.readinessScore}% readiness</span>
      </div>
      <p class="card-summary">${escapeHtml(governance.reason)}</p>
      <div class="policy-summary">
        <span class="policy-count pass">${passed.length} passed</span>
        <span class="policy-count warn">${warned.length} warnings</span>
        <span class="policy-count fail">${failed.length} failed</span>
      </div>
      <p class="card-meta">Decision: <strong>${escapeHtml(governance.decision)}</strong>${governance.approver ? ` · Approver: ${escapeHtml(governance.approver)}` : ''}</p>
      <ul class="policy-list">${policyRows}</ul>
    </section>
  `;
}
