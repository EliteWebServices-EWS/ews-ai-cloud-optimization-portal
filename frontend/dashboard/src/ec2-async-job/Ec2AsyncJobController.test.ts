import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Ec2AsyncJobController } from './Ec2AsyncJobController';
import type { Ec2AsyncJob } from '../api/ec2-async-job-types';
import type { Ec2DashboardController } from '../pages/Ec2DashboardController';

function sampleJob(overrides: Partial<Ec2AsyncJob> = {}): Ec2AsyncJob {
  return {
    jobId: 'job-abc',
    accountId: '111122223333',
    regions: ['us-east-1'],
    jobType: 'EC2_INTELLIGENCE',
    status: 'QUEUED',
    queueStatus: 'ENQUEUED',
    stage: 'ENQUEUE',
    correlationId: 'c1',
    retryCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

describe('Ec2AsyncJobController integration', () => {
  let progress: HTMLElement;
  let history: HTMLElement;
  let loadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    progress = document.createElement('div');
    history = document.createElement('div');
    loadMock = vi.fn().mockResolvedValue(undefined);
  });

  function createController(options?: {
    startJob?: ReturnType<typeof vi.fn>;
    getJob?: ReturnType<typeof vi.fn>;
    listJobs?: ReturnType<typeof vi.fn>;
    createKey?: () => string;
  }) {
    return new Ec2AsyncJobController({
      progressPanel: progress,
      historyPanel: history,
      getAccountId: () => '111122223333',
      getRegions: () => ['us-east-1'],
      ec2Dashboard: { load: loadMock } as unknown as Ec2DashboardController,
      startJob: options?.startJob,
      getJob: options?.getJob,
      listJobs: options?.listJobs,
      createKey: options?.createKey ?? (() => 'idem-test-key'),
    });
  }

  it('uses list jobs for history with limit', async () => {
    const listJobs = vi.fn().mockResolvedValue({ items: [sampleJob()], nextToken: undefined });
    const controller = createController({ listJobs });
    await controller.initialize();
    expect(listJobs).toHaveBeenCalledWith({ limit: 20, nextToken: undefined });
    expect(history.textContent).toContain('Analysis Jobs');
  });

  it('starts analysis with authenticated start API shape', async () => {
    const startJob = vi.fn().mockResolvedValue({
      jobId: 'job-new',
      status: 'QUEUED',
      queueStatus: 'ENQUEUED',
      correlationId: 'c-new',
    });
    const getJob = vi.fn().mockResolvedValue(sampleJob({ jobId: 'job-new' }));
    const controller = createController({ startJob, getJob, listJobs: vi.fn().mockResolvedValue({ items: [] }) });
    await controller.initialize();
    await controller.startAnalysisFromUi();
    expect(startJob).toHaveBeenCalledWith(
      { accountId: '111122223333', regions: ['us-east-1'] },
      'idem-test-key',
    );
    expect(controller.getActiveJobId()).toBe('job-new');
  });

  it('deduplicates completion refresh by jobId', async () => {
    vi.useFakeTimers();
    const jobs = [
      sampleJob({ jobId: 'job-done', status: 'RUNNING', stage: 'FINALIZING' }),
      sampleJob({ jobId: 'job-done', status: 'SUCCEEDED', stage: 'COMPLETE', completedAt: '2026-01-01T01:00:00.000Z' }),
    ];
    const getJob = vi.fn(async () => jobs.shift() ?? sampleJob({ status: 'SUCCEEDED', stage: 'COMPLETE' }));
    const startJob = vi.fn().mockResolvedValue({
      jobId: 'job-done',
      status: 'QUEUED',
      queueStatus: 'ENQUEUED',
      correlationId: 'c1',
    });
    const controller = createController({
      startJob,
      getJob,
      listJobs: vi.fn().mockResolvedValue({ items: [] }),
    });
    await controller.initialize();
    await controller.startAnalysisFromUi();
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(controller.wasCompletionRefreshDone('job-done')).toBe(true);
    vi.useRealTimers();
  });

  it('retry uses new start request and fresh idempotency keys', async () => {
    const keys: string[] = [];
    const startJob = vi.fn().mockResolvedValue({
      jobId: 'job-retry',
      status: 'QUEUED',
      queueStatus: 'ENQUEUED',
      correlationId: 'c-retry',
    });
    const getJob = vi.fn().mockResolvedValue(sampleJob({ jobId: 'job-retry' }));
    const controller = createController({
      startJob,
      getJob,
      listJobs: vi.fn().mockResolvedValue({ items: [sampleJob({ status: 'FAILED', stage: 'DISCOVERY' })] }),
      createKey: () => {
        keys.push(`key-${keys.length + 1}`);
        return keys[keys.length - 1];
      },
    });
    await controller.initialize();
    await controller.retryJob(sampleJob({ status: 'FAILED', stage: 'DISCOVERY' }));
    expect(startJob).toHaveBeenCalledWith(
      { accountId: '111122223333', regions: ['us-east-1'] },
      'key-1',
    );
    expect(keys).toHaveLength(1);
    expect(controller.getActiveJobId()).toBe('job-retry');
  });

  it('prevents duplicate retry clicks while in flight', async () => {
    let resolveStart: () => void = () => {};
    const startJob = vi.fn(
      () =>
        new Promise<{ jobId: string; status: 'QUEUED'; queueStatus: 'ENQUEUED'; correlationId: string }>(
          (resolve) => {
            resolveStart = () =>
              resolve({
                jobId: 'job-retry',
                status: 'QUEUED',
                queueStatus: 'ENQUEUED',
                correlationId: 'c1',
              });
          },
        ),
    );
    const controller = createController({
      startJob,
      getJob: vi.fn().mockResolvedValue(sampleJob({ jobId: 'job-retry' })),
      listJobs: vi.fn().mockResolvedValue({ items: [] }),
    });
    await controller.initialize();
    const failed = sampleJob({ status: 'FAILED', stage: 'DISCOVERY' });
    const first = controller.retryJob(failed);
    const second = controller.retryJob(failed);
    resolveStart();
    await first;
    await second;
    expect(startJob).toHaveBeenCalledTimes(1);
  });

  it('marks reports freshness signal once on completion refresh', async () => {
    sessionStorage.clear();
    vi.useFakeTimers();
    const jobs = [
      sampleJob({ jobId: 'job-done', status: 'RUNNING', stage: 'FINALIZING' }),
      sampleJob({
        jobId: 'job-done',
        status: 'SUCCEEDED',
        stage: 'COMPLETE',
        completedAt: '2026-01-01T01:00:00.000Z',
      }),
    ];
    const getJob = vi.fn(async () => jobs.shift() ?? sampleJob({ status: 'SUCCEEDED', stage: 'COMPLETE' }));
    const startJob = vi.fn().mockResolvedValue({
      jobId: 'job-done',
      status: 'QUEUED',
      queueStatus: 'ENQUEUED',
      correlationId: 'c1',
    });
    const controller = createController({
      startJob,
      getJob,
      listJobs: vi.fn().mockResolvedValue({ items: [] }),
    });
    await controller.initialize();
    await controller.startAnalysisFromUi();
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sessionStorage.getItem('sisum.ec2AsyncJob.completed')).toContain('job-done');
    vi.useRealTimers();
  });

  it('does not call invented retry endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const controller = createController({
      startJob: vi.fn(),
      getJob: vi.fn(),
      listJobs: vi.fn().mockResolvedValue({ items: [] }),
    });
    await controller.initialize();
    const retryPaths = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/retry'));
    expect(retryPaths).toHaveLength(0);
    fetchSpy.mockRestore();
  });
});
