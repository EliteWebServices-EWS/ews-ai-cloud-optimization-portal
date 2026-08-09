/**
 * EC2 async job progress stepper — reuses progress-panel styling.
 */

import type { Ec2AsyncJob } from '../api/ec2-async-job-types';
import { escapeHtml } from '../utils/format';
import {
  EC2_ASYNC_PROGRESS_STEPS,
  mapEc2AsyncJobToDisplayState,
  type Ec2AsyncJobProgressLabel,
} from './ec2-async-job-status-mapping';
import { computeElapsedMs, formatElapsedDuration, formatJobTimestamp } from './ec2-async-job-time';

export interface Ec2AsyncJobProgressViewModel {
  job: Ec2AsyncJob;
  localStarting?: boolean;
  pollWarning?: string;
  nowMs?: number;
}

function stepState(
  step: Ec2AsyncJobProgressLabel,
  current: Ec2AsyncJobProgressLabel,
  display: ReturnType<typeof mapEc2AsyncJobToDisplayState>,
): 'pending' | 'active' | 'completed' | 'failed' {
  if (display.failed && step === 'Failed') {
    return 'failed';
  }
  if (display.failed) {
    const idx = EC2_ASYNC_PROGRESS_STEPS.indexOf(step);
    const activeIdx = EC2_ASYNC_PROGRESS_STEPS.indexOf(current);
    if (idx >= 0 && activeIdx >= 0 && idx <= activeIdx) {
      return idx === activeIdx ? 'failed' : 'completed';
    }
    return 'pending';
  }

  if (display.succeeded) {
    return step === 'Completed' || EC2_ASYNC_PROGRESS_STEPS.indexOf(step) < EC2_ASYNC_PROGRESS_STEPS.length - 1
      ? 'completed'
      : 'pending';
  }

  const order = EC2_ASYNC_PROGRESS_STEPS;
  const stepIdx = order.indexOf(step);
  const currentIdx = order.indexOf(current);
  if (stepIdx < 0 || currentIdx < 0) {
    return step === current ? 'active' : 'pending';
  }
  if (stepIdx < currentIdx) {
    return 'completed';
  }
  if (stepIdx === currentIdx) {
    return 'active';
  }
  return 'pending';
}

export function renderEc2AsyncJobProgress(
  container: HTMLElement,
  model: Ec2AsyncJobProgressViewModel,
): void {
  const { job, localStarting, pollWarning } = model;
  const nowMs = model.nowMs ?? Date.now();
  const display = mapEc2AsyncJobToDisplayState(job.status, job.stage, { localStarting });
  const failedStageLabel =
    display.failed && job.stage
      ? mapEc2AsyncJobToDisplayState('RUNNING', job.stage).label
      : null;
  const currentLabel = display.failed ? failedStageLabel ?? 'Discovering Resources' : display.label;
  const steps = EC2_ASYNC_PROGRESS_STEPS.map((step) => {
    const state = stepState(step, currentLabel, display);
    return `<li class="progress-step step-${state}"><span class="step-dot" aria-hidden="true"></span><span>${escapeHtml(step)}</span></li>`;
  }).join('');

  const elapsed = formatElapsedDuration(computeElapsedMs(job, nowMs));
  const statusText = display.label;
  const milestone = display.milestonePercent;

  const errorBlock =
    job.errorSummary && display.failed
      ? `<p class="job-error-summary" role="alert">${escapeHtml(job.errorSummary)}</p>`
      : '';

  const warningBlock = pollWarning
    ? `<p class="job-poll-warning" role="status">${escapeHtml(pollWarning)}</p>`
    : '';

  container.innerHTML = `
    <section class="dashboard-card" aria-labelledby="progress-heading">
      <h3 id="progress-heading" class="card-title">EC2 Analysis Progress</h3>
      <p class="job-progress-status" aria-live="polite">
        <span class="status-badge">${escapeHtml(display.failed ? 'Failed' : statusText)}</span>
        <span class="job-elapsed">Elapsed: ${escapeHtml(elapsed)}</span>
      </p>
      <div
        class="job-milestone-bar"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="${milestone}"
        aria-label="Analysis stage milestone (${milestone} percent reflects stage order, not exact work completed)"
      >
        <div class="job-milestone-fill" style="width: ${milestone}%"></div>
      </div>
      <ol class="progress-list">${steps}</ol>
      <dl class="job-timestamp-grid">
        <div><dt>Created</dt><dd>${escapeHtml(formatJobTimestamp(job.createdAt))}</dd></div>
        <div><dt>Started</dt><dd>${escapeHtml(formatJobTimestamp(job.startedAt))}</dd></div>
        <div><dt>Completed</dt><dd>${escapeHtml(formatJobTimestamp(job.completedAt))}</dd></div>
      </dl>
      ${warningBlock}
      ${errorBlock}
    </section>
  `;
}

export function renderEc2AsyncJobProgressPlaceholder(
  container: HTMLElement,
  message = 'Start an analysis to track EC2 job progress.',
): void {
  container.innerHTML = `
    <section class="dashboard-card" aria-labelledby="progress-heading">
      <h3 id="progress-heading" class="card-title">EC2 Analysis Progress</h3>
      <p class="empty-note">${escapeHtml(message)}</p>
    </section>
  `;
}
