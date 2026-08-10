/**
 * Renders demo workflow progress and decision-intelligence panels (public demo only).
 */

import { renderCandidateCard } from '../components/CandidateCard';
import { renderConfidenceIndicator } from '../components/ConfidenceIndicator';
import { renderEvidenceStatus } from '../components/EvidenceStatus';
import { renderFinancialImpactCard } from '../components/FinancialImpactCard';
import { renderGovernancePanel } from '../components/GovernancePanel';
import { renderRecommendationCard } from '../components/RecommendationCard';
import { escapeHtml, formatCurrency, statusClass } from '../utils/format';
import type { DemoDecisionIntelligenceSnapshot, DemoDecisionPanelElements, DemoReportPreviewSnapshot } from './ec2-demo-decision-types';
import type { VerificationResult } from '../types';

const DEMO_STAGE_LABELS: Record<string, string> = {
  evidence: 'Evidence Collection',
  governance: 'Governance Evaluation',
  financial: 'Financial Analysis',
  confidence: 'Confidence Analysis',
  recommendation: 'Recommendation Analysis',
  execution: 'Execution Simulation',
  verification: 'Verification',
  learning: 'Learning Store',
};

export function renderDemoWorkflowProgress(
  container: HTMLElement,
  completedStages: readonly string[],
  currentStage?: string,
): void {
  const allStages = [
    'evidence',
    'governance',
    'financial',
    'confidence',
    'recommendation',
    'execution',
    'verification',
    'learning',
  ];

  const steps = allStages
    .map((stage) => {
      let state = 'pending';
      let stateLabel = 'Pending';
      if (completedStages.includes(stage)) {
        state = 'completed';
        stateLabel = 'Complete';
      } else if (currentStage === stage) {
        state = 'active';
        stateLabel = 'Analyzing';
      }
      const label = DEMO_STAGE_LABELS[stage] ?? stage;
      return `<li class="progress-step step-${state}" aria-label="${escapeHtml(label)}: ${stateLabel}"><span class="step-dot" aria-hidden="true"></span><span>${escapeHtml(label)}</span> <span class="step-state-text">(${stateLabel})</span></li>`;
    })
    .join('');

  container.innerHTML = `
    <section class="dashboard-card" aria-labelledby="demo-progress-heading">
      <h3 id="demo-progress-heading" class="card-title">SISU'M Decision Intelligence — Workflow Progress</h3>
      <p class="card-meta">Demonstration workflow stages (not production SQS/Lambda progress).</p>
      <ol class="progress-list">${steps}</ol>
    </section>
  `;
}

export function renderDemoDecisionIdle(container: HTMLElement): void {
  container.innerHTML =
    '<p class="empty-note">Select a scenario and click Analyze Demo Environment to run the illustrative decision workflow.</p>';
}

export function clearDemoDecisionPanels(elements: DemoDecisionPanelElements): void {
  for (const key of Object.keys(elements) as (keyof DemoDecisionPanelElements)[]) {
    if (key === 'workflowProgress' || key === 'reportPreview') {
      renderDemoDecisionIdle(elements[key]);
    } else {
      elements[key].innerHTML = '';
    }
  }
  elements.learningOutcome.textContent = '';
}

export function renderDemoConfidencePanel(
  container: HTMLElement,
  snapshot: DemoDecisionIntelligenceSnapshot,
): void {
  if (snapshot.confidenceUnavailable || !snapshot.confidence) {
    container.innerHTML = `
      <section class="dashboard-card" aria-labelledby="confidence-heading">
        <h3 id="confidence-heading" class="card-title">Confidence Intelligence</h3>
        <p class="empty-note">Not available for this demo scenario</p>
        <p class="card-meta">Recommendation confidence is not defined in the mock fixture (not compliance score).</p>
      </section>
    `;
    return;
  }
  renderConfidenceIndicator(container, snapshot.confidence);
}

export function renderDemoRecommendationPanel(
  container: HTMLElement,
  snapshot: DemoDecisionIntelligenceSnapshot,
): void {
  if (!snapshot.recommendation) {
    container.innerHTML = `
      <section class="dashboard-card" aria-labelledby="recommendation-heading">
        <h3 id="recommendation-heading" class="card-title">Recommendation</h3>
        <p class="empty-note">No optimization recommendation for this scenario</p>
      </section>
    `;
    return;
  }
  renderRecommendationCard(container, snapshot.recommendation);
}

function demoVerificationMetricRows(verification: VerificationResult): string {
  if (verification.status === 'NOT_EXECUTED') {
    const expectedDisplay =
      verification.expectedSavings > 0
        ? escapeHtml(formatCurrency(verification.expectedSavings))
        : 'Not applicable';
    return `
        <dl class="detail-list">
          <div><dt>Expected Savings</dt><dd>${expectedDisplay}</dd></div>
          <div><dt>Verified Savings</dt><dd>Not available — execution not performed</dd></div>
          <div><dt>Variance</dt><dd>Not applicable</dd></div>
          <div><dt>State Matched</dt><dd>Not evaluated</dd></div>
        </dl>
    `;
  }
  return `
        <dl class="detail-list">
          <div><dt>Expected Savings</dt><dd>${escapeHtml(formatCurrency(verification.expectedSavings))}</dd></div>
          <div><dt>Verified Savings</dt><dd class="highlight">${escapeHtml(formatCurrency(verification.verifiedSavings))}</dd></div>
          <div><dt>Variance</dt><dd>${escapeHtml(formatCurrency(verification.variance))} (${verification.variancePercentage.toFixed(1)}%)</dd></div>
          <div><dt>State Matched</dt><dd>${verification.stateMatched ? 'Yes' : 'No'}</dd></div>
        </dl>
  `;
}

export function renderDemoVerificationPanel(
  container: HTMLElement,
  snapshot: DemoDecisionIntelligenceSnapshot,
): void {
  const { execution, verification } = snapshot;
  container.innerHTML = `
    <section class="dashboard-card verification-card" aria-labelledby="verification-heading">
      <h3 id="verification-heading" class="card-title">Verification Result</h3>
      <div class="verification-row">
        <span class="label">Execution</span>
        <span class="${statusClass(execution.status)}">${escapeHtml(execution.status)}</span>
        ${execution.change ? `<span class="card-meta">${escapeHtml(execution.change.from)} → ${escapeHtml(execution.change.to)}</span>` : ''}
      </div>
      <div class="verification-row">
        <span class="label">Verification</span>
        <span class="${statusClass(verification.status)}">${escapeHtml(verification.status)}</span>
      </div>
      ${demoVerificationMetricRows(verification)}
      ${verification.message ? `<p class="card-summary">${escapeHtml(verification.message)}</p>` : ''}
      <p class="card-meta">${escapeHtml(snapshot.illustrativeDisclaimer)}</p>
    </section>
  `;
}

export function renderDemoReportPreviewSection(
  container: HTMLElement,
  preview: DemoReportPreviewSnapshot,
  options?: { heading?: string; subtitle?: string },
): void {
  const basis = preview.decisionBasis;
  const heading = options?.heading ?? 'Demo Report Preview';
  const subtitle =
    options?.subtitle ?? 'Illustrative reporting summary — not the authenticated Reports page.';
  container.innerHTML = `
    <section class="dashboard-card demo-report-preview" aria-labelledby="demo-report-preview-heading">
      <h3 id="demo-report-preview-heading" class="card-title">${escapeHtml(heading)}</h3>
      <p class="card-meta">${escapeHtml(subtitle)}</p>
      <h4>Executive Summary</h4>
      <p><strong>${escapeHtml(preview.executiveHeadline)}</strong></p>
      <p>${escapeHtml(preview.executiveSummary)}</p>
      <h4>Savings Summary</h4>
      <dl class="detail-list">
        <div><dt>Current monthly</dt><dd>${preview.currentMonthlyCost != null ? `$${preview.currentMonthlyCost.toFixed(2)}` : 'Unavailable in demo fixture'}</dd></div>
        <div><dt>Projected monthly</dt><dd>${preview.projectedMonthlyCost != null ? `$${preview.projectedMonthlyCost.toFixed(2)}` : 'Unavailable in demo fixture'}</dd></div>
        <div><dt>Estimated monthly savings</dt><dd>$${preview.estimatedMonthlySavings.toFixed(2)}</dd></div>
        <div><dt>Estimated annual savings</dt><dd>$${preview.estimatedAnnualSavings.toFixed(2)}</dd></div>
      </dl>
      <h4>Recommendation Summary</h4>
      <p>${escapeHtml(preview.recommendationSummary)}</p>
      <p><strong>Confidence:</strong> ${escapeHtml(preview.confidenceSummary)}</p>
      <p><strong>Governance:</strong> ${escapeHtml(preview.governanceDecision)}</p>
      <h4>Decision Basis</h4>
      <dl class="detail-list demo-decision-basis">
        <div><dt>Evidence</dt><dd>${escapeHtml(basis.evidence)}</dd></div>
        <div><dt>Governance</dt><dd>${escapeHtml(basis.governance)}</dd></div>
        <div><dt>Confidence</dt><dd>${escapeHtml(basis.confidence)}</dd></div>
        <div><dt>Execution</dt><dd>${escapeHtml(basis.execution)}</dd></div>
        <div><dt>Verification</dt><dd>${escapeHtml(basis.verification)}</dd></div>
      </dl>
      <h4>Verification Result</h4>
      <p>${escapeHtml(preview.verificationSummary)}</p>
    </section>
  `;
}

export function renderDemoDecisionIntelligence(
  elements: DemoDecisionPanelElements,
  snapshot: DemoDecisionIntelligenceSnapshot,
): void {
  renderDemoWorkflowProgress(elements.workflowProgress, snapshot.completedStages);

  elements.learningOutcome.innerHTML = `<p class="card-meta demo-learning-outcome">${escapeHtml(snapshot.learningOutcome)}</p>`;

  renderCandidateCard(elements.candidate, snapshot.workflowDetail);
  renderEvidenceStatus(elements.evidence, snapshot.evidence);
  renderGovernancePanel(elements.governance, snapshot.governance);
  renderFinancialImpactCard(elements.financial, snapshot.financial);
  renderDemoConfidencePanel(elements.confidence, snapshot);
  renderDemoRecommendationPanel(elements.recommendation, snapshot);

  renderDemoVerificationPanel(elements.verification, snapshot);

  renderDemoReportPreviewSection(elements.reportPreview, snapshot.reportPreview);
}

/**
 * Deterministic synchronous stage progression for demo presentation (no timers).
 */
export function runDemoWorkflowProgressAnimation(
  container: HTMLElement,
  onComplete: () => void,
): void {
  const stages = [
    'evidence',
    'governance',
    'financial',
    'confidence',
    'recommendation',
    'execution',
    'verification',
    'learning',
  ];
  for (let i = 0; i < stages.length; i++) {
    const completed = stages.slice(0, i);
    const current = stages[i];
    renderDemoWorkflowProgress(container, completed, current);
  }
  renderDemoWorkflowProgress(container, stages, undefined);
  onComplete();
}
