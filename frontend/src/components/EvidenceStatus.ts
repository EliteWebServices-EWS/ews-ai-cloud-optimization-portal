/**
 * EvidenceStatus — displays evidence collection readiness.
 */

import { escapeHtml, statusClass } from '../utils/format';
import type { EvidenceView } from '../types';

export function renderEvidenceStatus(container: HTMLElement, evidence?: EvidenceView): void {
  if (!evidence) {
    container.innerHTML = '<p class="empty-note">Evidence not yet collected.</p>';
    return;
  }

  const telemetry = evidence.telemetry;
  const validation = evidence.validation;

  container.innerHTML = `
    <section class="dashboard-card" aria-labelledby="evidence-heading">
      <h3 id="evidence-heading" class="card-title">Evidence Status</h3>
      <div class="card-header-row">
        <span class="${statusClass(evidence.status ?? 'pending')}">${escapeHtml(evidence.status ?? 'pending')}</span>
        <span class="card-meta">${validation?.valid ? 'Validated' : 'Incomplete'}</span>
      </div>
      <dl class="detail-list">
        <div><dt>CPU Utilization</dt><dd>${telemetry?.cpuUtilization ?? '—'}%</dd></div>
        <div><dt>Memory Utilization</dt><dd>${telemetry?.memoryUtilization ?? '—'}%</dd></div>
        <div><dt>Observation Window</dt><dd>${telemetry?.observationWindowDays ?? '—'} days</dd></div>
        <div><dt>Monthly Rate</dt><dd>${evidence.pricing?.monthlyRate != null ? `$${evidence.pricing.monthlyRate.toFixed(2)}` : '—'}</dd></div>
      </dl>
      ${validation?.warnings?.length ? `<p class="card-warning">${escapeHtml(validation.warnings.join('; '))}</p>` : ''}
    </section>
  `;
}
