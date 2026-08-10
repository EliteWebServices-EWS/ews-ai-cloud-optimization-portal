/**
 * EC2 async job history list (sanitized API fields only).
 */

import type { Ec2AsyncJob } from '../api/ec2-async-job-types';
import { escapeHtml } from '../utils/format';
import { mapEc2AsyncJobHistoryDisplay } from './ec2-async-job-history-display';
import { formatJobTimestamp } from './ec2-async-job-time';

export interface Ec2AsyncJobHistoryViewModel {
  items: Ec2AsyncJob[];
  /** Full loaded history for action handlers when `items` is a latest-only subset. */
  allItems?: Ec2AsyncJob[];
  loading: boolean;
  error?: string;
  activeJobId?: string;
  selectedJobId?: string;
  nextToken?: string;
  loadMoreEnabled?: boolean;
  retryInFlight?: boolean;
  totalJobCount?: number;
  latestVisibleCount?: number;
  historyExpanded?: boolean;
  historySummary?: string;
}

export function renderEc2AsyncJobHistory(
  container: HTMLElement,
  model: Ec2AsyncJobHistoryViewModel,
  handlers?: {
    onViewProgress?: (job: Ec2AsyncJob) => void;
    onRetry?: (job: Ec2AsyncJob) => void;
    onLoadMore?: () => void;
    onToggleHistory?: () => void;
  },
): void {
  const lookupItems = model.allItems ?? model.items;
  if (model.loading && model.items.length === 0) {
    container.innerHTML = `
      <section class="dashboard-card" aria-labelledby="job-history-heading">
        <h3 id="job-history-heading" class="card-title">Analysis Jobs</h3>
        <p class="empty-note" role="status">Loading job history…</p>
      </section>
    `;
    return;
  }

  if (model.error && model.items.length === 0) {
    container.innerHTML = `
      <section class="dashboard-card" aria-labelledby="job-history-heading">
        <h3 id="job-history-heading" class="card-title">Analysis Jobs</h3>
        <p class="empty-note" role="alert">${escapeHtml(model.error)}</p>
      </section>
    `;
    return;
  }

  if (model.items.length === 0) {
    container.innerHTML = `
      <section class="dashboard-card" aria-labelledby="job-history-heading">
        <h3 id="job-history-heading" class="card-title">Analysis Jobs</h3>
        <p class="empty-note">No EC2 analysis jobs yet.</p>
      </section>
    `;
    return;
  }

  const rows = model.items
    .map((job) => {
      const display = mapEc2AsyncJobHistoryDisplay(job, {
        activeJobId: model.activeJobId,
      });
      const isActive = model.activeJobId === job.jobId;
      const isSelected = model.selectedJobId === job.jobId;
      const rowClasses = [
        isSelected ? 'job-row-selected' : '',
        isActive ? 'job-row-active' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const regions = job.regions?.length ? job.regions.join(', ') : '—';
      const viewProgressButton = handlers?.onViewProgress
        ? `<button type="button" class="btn-secondary job-view-progress-btn" data-job-id="${escapeHtml(job.jobId)}" aria-label="View progress for job ${escapeHtml(job.jobId)}">View progress</button>`
        : '';
      const showRetry =
        (job.status === 'FAILED' || display.failed) && handlers?.onRetry;
      const retryButton =
        showRetry
          ? `<button type="button" class="btn-secondary job-retry-btn" data-job-id="${escapeHtml(job.jobId)}" ${
              model.retryInFlight ? 'disabled aria-busy="true"' : ''
            }>${model.retryInFlight ? 'Retrying…' : 'Retry analysis'}</button>`
          : '';
      const actions = [viewProgressButton, retryButton].filter(Boolean).join(' ');
      const statusCell = display.historyStatusDetail
        ? `<span class="job-history-status-main">${escapeHtml(display.label)}</span>
           <span class="job-history-status-detail">${escapeHtml(display.historyStatusDetail)}</span>`
        : escapeHtml(display.label);
      return `
        <tr class="${rowClasses}" data-job-id="${escapeHtml(job.jobId)}"${
          isSelected ? ' aria-current="true"' : ''
        }>
          <td><code>${escapeHtml(job.jobId.slice(0, 8))}…</code></td>
          <td class="job-history-status">${statusCell}</td>
          <td>••••${escapeHtml(job.accountId.slice(-4))}</td>
          <td>${escapeHtml(regions)}</td>
          <td>${escapeHtml(formatJobTimestamp(job.createdAt))}</td>
          <td class="job-history-actions">${actions}</td>
        </tr>
      `;
    })
    .join('');

  const loadMore =
    model.loadMoreEnabled && model.nextToken && handlers?.onLoadMore
      ? `<button type="button" class="btn-secondary" id="job-history-load-more">Load more</button>`
      : '';

  const totalCount = model.totalJobCount ?? model.items.length;
  const latestCount = model.latestVisibleCount ?? model.items.length;
  const hiddenOlder = Math.max(0, totalCount - latestCount);
  const showHistoryToggle =
    hiddenOlder > 0 && handlers?.onToggleHistory && model.historyExpanded !== undefined;
  const historyToggle = showHistoryToggle
    ? `<button type="button" class="btn-secondary" id="job-history-toggle" aria-expanded="${model.historyExpanded ? 'true' : 'false'}" aria-controls="job-history-table-body">${
        model.historyExpanded
          ? 'Hide analysis history'
          : `Show analysis history (${hiddenOlder})`
      }</button>`
    : '';

  const summaryLine = model.historySummary
    ? `<p class="job-history-summary" id="job-history-summary">${escapeHtml(model.historySummary)}</p>`
    : '';

  container.innerHTML = `
    <section class="dashboard-card" aria-labelledby="job-history-heading">
      <h3 id="job-history-heading" class="card-title">${model.historyExpanded || hiddenOlder === 0 ? 'Analysis Jobs' : 'Latest Analysis'}</h3>
      ${summaryLine}
      ${historyToggle}
      ${model.error ? `<p class="job-poll-warning" role="status">${escapeHtml(model.error)}</p>` : ''}
      <div class="job-history-table-wrap">
        <table class="job-history-table" aria-describedby="job-history-heading">
          <thead>
            <tr>
              <th scope="col">Job</th>
              <th scope="col">Status</th>
              <th scope="col">Account</th>
              <th scope="col">Regions</th>
              <th scope="col">Created</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody id="job-history-table-body">${rows}</tbody>
        </table>
      </div>
      ${loadMore}
    </section>
  `;

  container.querySelectorAll('.job-view-progress-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
      const target = event.currentTarget as HTMLButtonElement;
      const jobId = target.getAttribute('data-job-id');
      const job = lookupItems.find((item) => item.jobId === jobId);
      if (job && handlers?.onViewProgress) {
        handlers.onViewProgress(job);
      }
    });
  });

  container.querySelectorAll('.job-retry-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
      const target = event.currentTarget as HTMLButtonElement;
      const jobId = target.getAttribute('data-job-id');
      const job = lookupItems.find((item) => item.jobId === jobId);
      if (job && handlers?.onRetry) {
        handlers.onRetry(job);
      }
    });
  });

  const loadMoreBtn = container.querySelector('#job-history-load-more');
  if (loadMoreBtn && handlers?.onLoadMore) {
    loadMoreBtn.addEventListener('click', () => {
      handlers.onLoadMore?.();
    });
  }

  const historyToggleBtn = container.querySelector('#job-history-toggle');
  if (historyToggleBtn && handlers?.onToggleHistory) {
    historyToggleBtn.addEventListener('click', () => {
      handlers.onToggleHistory?.();
    });
  }
}
