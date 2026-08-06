/**
 * EC2SecurityFindingsCard — summarizes EC2 security exposures.
 */

import { escapeHtml } from '../utils/format';
import type { Ec2SecurityFinding } from '../types';

export function renderEc2SecurityFindingsCard(
  container: HTMLElement,
  findings: Ec2SecurityFinding[] = []
): void {
  if (findings.length === 0) {
    container.innerHTML = '<p class="empty-note">No active security findings.</p>';
    return;
  }

  const items = findings
    .map(
      (finding) => `
        <li>
          <header>
            <strong>${escapeHtml(finding.title)}</strong>
            <span class="severity-${escapeHtml(finding.severity.toLowerCase())}">${escapeHtml(finding.severity)}</span>
          </header>
          <p>${finding.count} matched condition(s)</p>
          <small>${escapeHtml(finding.remediation)}</small>
        </li>
      `
    )
    .join('');

  container.innerHTML = `
    <section class="dashboard-card" aria-labelledby="ec2-security-heading">
      <h3 id="ec2-security-heading" class="card-title">Security Findings</h3>
      <ul class="finding-list">${items}</ul>
    </section>
  `;
}
