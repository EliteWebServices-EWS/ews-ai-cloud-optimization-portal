/**
 * Orchestrates EC2 async analysis start, polling, history, retry, and completion refresh.
 */

import {
  createIdempotencyKey,
  getEc2AnalysisJob,
  listEc2AnalysisJobs,
  startEc2Analysis,
} from '../api/ec2-async-job-api';
import type { Ec2AsyncJob } from '../api/ec2-async-job-types';
import { ApiClientError } from '../api/client';
import { showAppNotification } from '../components/AppNotifications';
import type { Ec2DashboardController } from '../pages/Ec2DashboardController';
import { Ec2AsyncJobPoller } from './ec2-async-job-poller';
import { isTerminalJobStatus, mapEc2AsyncJobToDisplayState } from './ec2-async-job-status-mapping';
import {
  renderEc2AsyncJobHistory,
  type Ec2AsyncJobHistoryViewModel,
} from './render-ec2-async-job-history';
import {
  renderEc2AsyncJobProgress,
  renderEc2AsyncJobProgressPlaceholder,
} from './render-ec2-async-job-progress';
import { markEc2AsyncJobCompleted } from './ec2-async-job-freshness';

export type JobTransition =
  | 'queued'
  | 'started'
  | 'completed'
  | 'failed'
  | 'retry_available';

export interface Ec2AsyncJobControllerOptions {
  progressPanel: HTMLElement;
  historyPanel: HTMLElement;
  getAccountId: () => string | undefined;
  getRegions: () => string[];
  ec2Dashboard: Ec2DashboardController;
  listJobs?: typeof listEc2AnalysisJobs;
  getJob?: typeof getEc2AnalysisJob;
  startJob?: typeof startEc2Analysis;
  createKey?: () => string;
}

const HISTORY_PAGE_LIMIT = 20;

export class Ec2AsyncJobController {
  private poller: Ec2AsyncJobPoller | null = null;
  private generation = 0;
  private activeJobId: string | null = null;
  private activeJob: Ec2AsyncJob | null = null;
  private localStarting = false;
  private pollWarning: string | undefined;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private historyItems: Ec2AsyncJob[] = [];
  private historyNextToken: string | undefined;
  private historyLoading = false;
  private historyError: string | undefined;
  private retryInFlight = false;
  private startInFlight = false;
  private notifiedTransitions = new Set<string>();
  private completionRefreshDone = new Set<string>();
  private lastNotifiedStageKey = new Map<string, string>();

  private readonly listJobsFn: typeof listEc2AnalysisJobs;
  private readonly getJobFn: typeof getEc2AnalysisJob;
  private readonly startJobFn: typeof startEc2Analysis;
  private readonly createKeyFn: () => string;

  constructor(private readonly options: Ec2AsyncJobControllerOptions) {
    this.listJobsFn = options.listJobs ?? listEc2AnalysisJobs;
    this.getJobFn = options.getJob ?? getEc2AnalysisJob;
    this.startJobFn = options.startJob ?? startEc2Analysis;
    this.createKeyFn = options.createKey ?? createIdempotencyKey;
  }

  async initialize(): Promise<void> {
    renderEc2AsyncJobProgressPlaceholder(this.options.progressPanel);
    await this.refreshHistory();
  }

  destroy(): void {
    this.stopPolling();
    this.stopElapsedTicker();
  }

  async startAnalysisFromUi(): Promise<void> {
    if (this.startInFlight) {
      return;
    }
    const accountId = this.options.getAccountId();
    if (!accountId) {
      throw new ApiClientError('INVALID_REQUEST', 'Select a connected AWS account before analyzing.');
    }
    const regions = this.options.getRegions();
    const idempotencyKey = this.createKeyFn();
    this.startInFlight = true;
    try {
      await this.startAnalysis({ accountId, regions }, idempotencyKey);
    } finally {
      this.startInFlight = false;
    }
  }

  async retryJob(job: Ec2AsyncJob): Promise<void> {
    if (this.retryInFlight) {
      return;
    }
    this.retryInFlight = true;
    try {
      const idempotencyKey = this.createKeyFn();
      await this.startAnalysis(
        { accountId: job.accountId, regions: job.regions },
        idempotencyKey,
      );
      showAppNotification('Retry submitted as a new analysis job.', 'info');
    } finally {
      this.retryInFlight = false;
      this.renderHistory();
    }
  }

  private async startAnalysis(
    body: { accountId: string; regions?: string[] },
    idempotencyKey: string,
  ): Promise<void> {
    this.stopPolling();
    this.generation += 1;
    const generation = this.generation;
    this.localStarting = true;
    this.pollWarning = undefined;

    const startResult = await this.startJobFn(body, idempotencyKey);
    if (generation !== this.generation) {
      return;
    }

    this.activeJobId = startResult.jobId;
    try {
      this.activeJob = await this.getJobFn(startResult.jobId);
    } catch {
      this.activeJob = {
        jobId: startResult.jobId,
        accountId: body.accountId,
        regions: body.regions ?? [],
        jobType: 'EC2_INTELLIGENCE',
        status: startResult.status,
        queueStatus: startResult.queueStatus,
        stage: 'ENQUEUE',
        correlationId: startResult.correlationId,
        retryCount: 0,
        createdAt: '',
        version: 1,
      };
    }

    this.notifyOnce(startResult.jobId, 'queued', 'Analysis queued.');
    this.renderProgress();
    void this.refreshHistory();

    this.beginPolling(startResult.jobId, generation);
  }

  private beginPolling(jobId: string, generation: number): void {
    this.stopPolling();
    this.startElapsedTicker();

    this.poller = new Ec2AsyncJobPoller({
      jobId,
      generation,
      fetchJob: async (id, signal) => {
        const job = await this.getJobFn(id);
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        return job;
      },
      onUpdate: (job, gen) => {
        if (gen !== this.generation || jobId !== this.activeJobId) {
          return;
        }
        this.localStarting = false;
        this.activeJob = job;
        this.handleStageNotification(job);
        this.renderProgress();
      },
      onTerminal: (job, gen) => {
        if (gen !== this.generation || jobId !== this.activeJobId) {
          return;
        }
        this.localStarting = false;
        this.activeJob = job;
        this.renderProgress();
        void this.refreshHistory();
        if (job.status === 'FAILED') {
          this.notifyOnce(job.jobId, 'failed', 'Analysis failed.');
          this.notifyOnce(job.jobId, 'retry_available', 'You can retry this analysis.');
        } else {
          this.notifyOnce(job.jobId, 'completed', 'Analysis completed.');
          void this.runCompletionRefresh(job.jobId, gen, job.completedAt);
        }
        this.stopElapsedTicker();
      },
      onPollError: (_error, gen) => {
        if (gen !== this.generation) {
          return;
        }
        this.pollWarning = 'Connection issue — showing last known job status.';
        this.renderProgress();
      },
      isHidden: () => document.hidden,
    });

    this.poller.start();
  }

  private async runCompletionRefresh(
    jobId: string,
    generation: number,
    completedAt?: string,
  ): Promise<void> {
    if (this.completionRefreshDone.has(jobId)) {
      return;
    }
    if (generation !== this.generation || jobId !== this.activeJobId) {
      return;
    }
    this.completionRefreshDone.add(jobId);
    await this.options.ec2Dashboard.load();
    markEc2AsyncJobCompleted(jobId, completedAt);
  }

  private handleStageNotification(job: Ec2AsyncJob): void {
    const display = mapEc2AsyncJobToDisplayState(job.status, job.stage);
    const stageKey = `${job.status}:${job.stage}:${display.label}`;
    const previous = this.lastNotifiedStageKey.get(job.jobId);
    if (previous === stageKey) {
      return;
    }
    this.lastNotifiedStageKey.set(job.jobId, stageKey);

    if (job.status === 'RUNNING' && job.stage === 'DISCOVERY') {
      this.notifyOnce(job.jobId, 'started', 'Analysis started.');
    }
  }

  private notifyOnce(jobId: string, transition: JobTransition, message: string): void {
    const key = `${jobId}:${transition}`;
    if (this.notifiedTransitions.has(key)) {
      return;
    }
    this.notifiedTransitions.add(key);
    const kind =
      transition === 'failed' ? 'error' : transition === 'completed' ? 'success' : 'info';
    showAppNotification(message, kind);
  }

  async refreshHistory(loadMore = false): Promise<void> {
    this.historyLoading = !loadMore;
    this.historyError = undefined;
    this.renderHistory();
    try {
      const page = await this.listJobsFn({
        limit: HISTORY_PAGE_LIMIT,
        nextToken: loadMore ? this.historyNextToken : undefined,
      });
      if (loadMore) {
        this.historyItems = [...this.historyItems, ...page.items];
      } else {
        this.historyItems = page.items;
      }
      this.historyNextToken = page.nextToken;
    } catch (error) {
      this.historyError =
        error instanceof ApiClientError
          ? error.message
          : 'Job history is temporarily unavailable.';
    } finally {
      this.historyLoading = false;
      this.renderHistory();
    }
  }

  private renderProgress(): void {
    if (!this.activeJob) {
      renderEc2AsyncJobProgressPlaceholder(this.options.progressPanel);
      return;
    }
    renderEc2AsyncJobProgress(this.options.progressPanel, {
      job: this.activeJob,
      localStarting: this.localStarting,
      pollWarning: this.pollWarning,
    });
  }

  private renderHistory(): void {
    const model: Ec2AsyncJobHistoryViewModel = {
      items: this.historyItems,
      loading: this.historyLoading,
      error: this.historyError,
      activeJobId: this.activeJobId ?? undefined,
      nextToken: this.historyNextToken,
      loadMoreEnabled: Boolean(this.historyNextToken),
      retryInFlight: this.retryInFlight,
    };
    renderEc2AsyncJobHistory(this.options.historyPanel, model, {
      onRetry: (job) => {
        void this.retryJob(job);
      },
      onLoadMore: () => {
        void this.refreshHistory(true);
      },
    });
  }

  private stopPolling(): void {
    this.poller?.stop();
    this.poller = null;
  }

  private startElapsedTicker(): void {
    this.stopElapsedTicker();
    this.elapsedTimer = setInterval(() => {
      if (!this.activeJob || isTerminalJobStatus(this.activeJob.status, this.activeJob.stage)) {
        this.stopElapsedTicker();
        return;
      }
      this.renderProgress();
    }, 1000);
  }

  private stopElapsedTicker(): void {
    if (this.elapsedTimer !== null) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }

  /** Test hooks */
  getActiveJobId(): string | null {
    return this.activeJobId;
  }

  getGeneration(): number {
    return this.generation;
  }

  getActiveJob(): Ec2AsyncJob | null {
    return this.activeJob;
  }

  wasCompletionRefreshDone(jobId: string): boolean {
    return this.completionRefreshDone.has(jobId);
  }
}
