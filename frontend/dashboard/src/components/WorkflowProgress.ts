/**
 * WorkflowProgress — displays completed and failed workflow stages.
 */

import { escapeHtml } from '../utils/format';

const STAGE_LABELS: Record<string, string> = {
  evidence: 'Evidence Collection',
  governance: 'Governance Evaluation',
  financial: 'Financial Analysis',
  confidence: 'Confidence Analysis',
  recommendation: 'Recommendation',
  execution: 'Execution',
  verification: 'Verification',
  learning: 'Learning Store',
};

export function renderWorkflowProgress(
  container: HTMLElement,
  completedStages: string[],
  failedStages: string[],
  currentStage?: string
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
      if (completedStages.includes(stage)) state = 'completed';
      if (failedStages.includes(stage)) state = 'failed';
      if (currentStage === stage && state === 'pending') state = 'active';
      const label = STAGE_LABELS[stage] ?? stage;
      return `<li class="progress-step step-${state}"><span class="step-dot"></span><span>${escapeHtml(label)}</span></li>`;
    })
    .join('');

  container.innerHTML = `
    <section class="dashboard-card" aria-labelledby="progress-heading">
      <h3 id="progress-heading" class="card-title">Workflow Progress</h3>
      <ol class="progress-list">${steps}</ol>
    </section>
  `;
}
