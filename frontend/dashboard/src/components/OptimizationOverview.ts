/**
 * OptimizationOverview — displays platform-level metrics from backend data.
 */

import { escapeHtml, formatCurrency } from '../utils/format';
import type { OverviewMetrics } from '../types';

export function renderOptimizationOverview(
  container: HTMLElement,
  metrics: OverviewMetrics
): void {
  container.innerHTML = `
    <section class="dashboard-section" aria-labelledby="overview-heading">
      <h3 id="overview-heading" class="section-title">Overview</h3>
      <div class="metric-grid">
        <article class="metric-card">
          <h4>Total Candidates</h4>
          <div class="metric-value">${metrics.totalCandidates}</div>
          <p class="metric-note">Discovered optimization targets</p>
        </article>
        <article class="metric-card">
          <h4>Ready Candidates</h4>
          <div class="metric-value">${metrics.readyCandidates}</div>
          <p class="metric-note">Evidence-ready for evaluation</p>
        </article>
        <article class="metric-card">
          <h4>Potential Savings</h4>
          <div class="metric-value">${escapeHtml(formatCurrency(metrics.potentialMonthlySavings))}</div>
          <p class="metric-note">Monthly estimate from backend</p>
        </article>
        <article class="metric-card">
          <h4>Average Confidence</h4>
          <div class="metric-value">${metrics.averageConfidence}%</div>
          <p class="metric-note">Trust score from Confidence Engine</p>
        </article>
      </div>
    </section>
  `;
}
