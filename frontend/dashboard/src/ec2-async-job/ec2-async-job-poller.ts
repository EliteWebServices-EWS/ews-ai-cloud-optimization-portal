/**
 * Single active-job polling loop for EC2 async analysis.
 */

import type { Ec2AsyncJob } from '../api/ec2-async-job-types';
import { isTerminalJobStatus } from './ec2-async-job-status-mapping';

export type FetchJobFn = (jobId: string, signal: AbortSignal) => Promise<Ec2AsyncJob>;

export interface Ec2AsyncJobPollingOptions {
  jobId: string;
  generation: number;
  fetchJob: FetchJobFn;
  intervalMs?: number;
  onUpdate: (job: Ec2AsyncJob, generation: number) => void;
  onTerminal: (job: Ec2AsyncJob, generation: number) => void;
  onPollError?: (error: unknown, generation: number) => void;
  isHidden?: () => boolean;
}

const DEFAULT_INTERVAL_MS = 4000;
const MAX_BACKOFF_MS = 30000;

export class Ec2AsyncJobPoller {
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private inFlight = false;
  private disposed = false;
  private consecutiveErrors = 0;
  private lastJob: Ec2AsyncJob | null = null;

  constructor(private readonly options: Ec2AsyncJobPollingOptions) {}

  start(): void {
    this.disposed = false;
    void this.scheduleTick(0);
  }

  stop(): void {
    this.disposed = true;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.abortController?.abort();
    this.abortController = null;
    this.inFlight = false;
  }

  getLastKnownJob(): Ec2AsyncJob | null {
    return this.lastJob;
  }

  private scheduleTick(delayMs: number): void {
    if (this.disposed) {
      return;
    }
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
    }
    this.timerId = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    if (this.disposed) {
      return;
    }

    if (this.options.isHidden?.()) {
      this.scheduleTick(this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
      return;
    }

    if (this.inFlight) {
      this.scheduleTick(this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
      return;
    }

    this.inFlight = true;
    this.abortController?.abort();
    this.abortController = new AbortController();

    const generation = this.options.generation;
    const jobId = this.options.jobId;

    try {
      const job = await this.options.fetchJob(jobId, this.abortController.signal);
      if (this.disposed || generation !== this.options.generation || jobId !== this.options.jobId) {
        return;
      }
      this.consecutiveErrors = 0;
      this.lastJob = job;
      this.options.onUpdate(job, generation);

      if (isTerminalJobStatus(job.status, job.stage)) {
        this.options.onTerminal(job, generation);
        this.stop();
        return;
      }

      this.scheduleTick(this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    } catch (error) {
      if (this.disposed || generation !== this.options.generation) {
        return;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      this.consecutiveErrors += 1;
      this.options.onPollError?.(error, generation);
      const backoff = Math.min(
        MAX_BACKOFF_MS,
        (this.options.intervalMs ?? DEFAULT_INTERVAL_MS) * this.consecutiveErrors,
      );
      this.scheduleTick(backoff);
    } finally {
      this.inFlight = false;
    }
  }
}
