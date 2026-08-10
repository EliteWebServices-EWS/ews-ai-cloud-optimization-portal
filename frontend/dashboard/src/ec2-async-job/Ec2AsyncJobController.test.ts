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

  it('shows select-job empty state when history exists but nothing selected', async () => {
    const listJobs = vi.fn().mockResolvedValue({
      items: [sampleJob({ jobId: 'job-old', status: 'SUCCEEDED', stage: 'COMPLETE' })],
    });
    const controller = createController({ listJobs });
    await controller.initialize();
    expect(progress.textContent).toContain('Select an analysis job below to view its progress.');
  });

  it('renders View progress on history rows', async () => {
    const listJobs = vi.fn().mockResolvedValue({ items: [sampleJob()] });
    const controller = createController({ listJobs, getJob: vi.fn() });
    await controller.initialize();
    expect(history.querySelector('.job-view-progress-btn')).toBeTruthy();
    expect(history.textContent).toContain('View progress');
  });

  it('loads completed job via getJob when View progress is used', async () => {
    const completed = sampleJob({
      jobId: 'job-done',
      status: 'SUCCEEDED',
      stage: 'COMPLETE',
      completedAt: '2026-01-01T01:00:00.000Z',
    });
    const getJob = vi.fn().mockResolvedValue(completed);
    const startJob = vi.fn();
    const controller = createController({
      getJob,
      startJob,
      listJobs: vi.fn().mockResolvedValue({ items: [completed] }),
    });
    await controller.initialize();
    await controller.viewJobProgress('job-done');
    expect(getJob).toHaveBeenCalledWith('job-done');
    expect(startJob).not.toHaveBeenCalled();
    expect(controller.getSelectedJobId()).toBe('job-done');
    expect(progress.querySelectorAll('.progress-step.step-completed')).toHaveLength(8);
  });

  it('viewJobProgress does not invoke start analysis', async () => {
    const failed = sampleJob({
      jobId: 'job-fail',
      status: 'FAILED',
      stage: 'DISCOVERY',
      errorSummary: 'Safe failure summary',
    });
    const getJob = vi.fn().mockResolvedValue(failed);
    const startJob = vi.fn();
    const controller = createController({
      getJob,
      startJob,
      listJobs: vi.fn().mockResolvedValue({ items: [failed] }),
    });
    await controller.initialize();
    await controller.viewJobProgress('job-fail');
    expect(startJob).not.toHaveBeenCalled();
    expect(progress.textContent).toContain('Safe failure summary');
    expect(progress.textContent).toContain('Failed');
  });

  it('marks selected history row with aria-current', async () => {
    const job = sampleJob({ jobId: 'job-sel' });
    const getJob = vi.fn().mockResolvedValue(job);
    const controller = createController({
      getJob,
      listJobs: vi.fn().mockResolvedValue({ items: [job] }),
    });
    await controller.initialize();
    await controller.viewJobProgress('job-sel');
    const row = history.querySelector('tr[aria-current="true"]');
    expect(row).toBeTruthy();
    expect(row?.classList.contains('job-row-selected')).toBe(true);
  });

  it('auto-selects newly started job in progress panel', async () => {
    const startJob = vi.fn().mockResolvedValue({
      jobId: 'job-new',
      status: 'QUEUED',
      queueStatus: 'ENQUEUED',
      correlationId: 'c-new',
    });
    const getJob = vi.fn().mockResolvedValue(sampleJob({ jobId: 'job-new' }));
    const controller = createController({
      startJob,
      getJob,
      listJobs: vi.fn().mockResolvedValue({ items: [] }),
    });
    await controller.initialize();
    await controller.startAnalysisFromUi();
    expect(controller.getSelectedJobId()).toBe('job-new');
    expect(controller.getDisplayJob()?.jobId).toBe('job-new');
    expect(progress.textContent).not.toContain('Select an analysis job');
  });

  it('retry remains separate from view progress', async () => {
    const keys: string[] = [];
    const failed = sampleJob({ jobId: 'job-fail', status: 'FAILED', stage: 'DISCOVERY' });
    const getJob = vi.fn().mockResolvedValue(failed);
    const startJob = vi.fn().mockResolvedValue({
      jobId: 'job-retry-new',
      status: 'QUEUED',
      queueStatus: 'ENQUEUED',
      correlationId: 'c2',
    });
    const controller = createController({
      startJob,
      getJob,
      listJobs: vi.fn().mockResolvedValue({ items: [failed] }),
      createKey: () => {
        keys.push(`k${keys.length}`);
        return keys[keys.length - 1];
      },
    });
    await controller.initialize();
    await controller.viewJobProgress('job-fail');
    expect(startJob).not.toHaveBeenCalled();
    await controller.retryJob(failed);
    expect(startJob).toHaveBeenCalledTimes(1);
  });

  it('does not poll indefinitely when viewing a completed historical job', async () => {
    vi.useFakeTimers();
    const completed = sampleJob({
      jobId: 'job-done',
      status: 'SUCCEEDED',
      stage: 'COMPLETE',
      completedAt: '2026-01-01T01:00:00.000Z',
    });
    const getJob = vi.fn().mockResolvedValue(completed);
    const controller = createController({
      getJob,
      listJobs: vi.fn().mockResolvedValue({ items: [completed] }),
    });
    await controller.initialize();
    await controller.viewJobProgress('job-done');
    expect(getJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getJob).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('updates progress panel when active job polls and is selected', async () => {
    vi.useFakeTimers();
    const running = sampleJob({ jobId: 'job-live', status: 'RUNNING', stage: 'DISCOVERY' });
    const getJob = vi.fn().mockResolvedValue(running);
    const startJob = vi.fn().mockResolvedValue({
      jobId: 'job-live',
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
    expect(progress.textContent).toContain('Discovering Resources');
    vi.useRealTimers();
  });

  it('replaces progress when switching selected jobs', async () => {
    const jobA = sampleJob({
      jobId: 'job-a',
      status: 'SUCCEEDED',
      stage: 'COMPLETE',
      completedAt: '2026-01-01T01:00:00.000Z',
    });
    const jobB = sampleJob({
      jobId: 'job-b',
      status: 'FAILED',
      stage: 'COST_ANALYSIS',
      errorSummary: 'Cost step failed',
    });
    const getJob = vi.fn(async (id: string) => (id === 'job-a' ? jobA : jobB));
    const controller = createController({
      getJob,
      listJobs: vi.fn().mockResolvedValue({ items: [jobA, jobB] }),
    });
    await controller.initialize();
    await controller.viewJobProgress('job-a');
    expect(progress.textContent).toContain('job-a');
    await controller.viewJobProgress('job-b');
    expect(progress.textContent).toContain('job-b');
    expect(progress.textContent).toContain('Cost step failed');
  });

  it('shows only newest job per scope by default', async () => {
    const jobs = [
      sampleJob({
        jobId: 'job-new',
        createdAt: '2026-08-10T06:56:00.000Z',
        status: 'SUCCEEDED',
        stage: 'COMPLETE',
      }),
      sampleJob({
        jobId: 'job-old',
        createdAt: '2026-08-09T17:31:00.000Z',
        status: 'SUCCEEDED',
        stage: 'COMPLETE',
      }),
    ];
    const controller = createController({
      listJobs: vi.fn().mockResolvedValue({ items: jobs }),
    });
    await controller.initialize();
    expect(history.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(history.textContent).toContain('Show analysis history (1)');
    expect(history.textContent).toContain('2 total runs');
  });

  it('expands analysis history with aria-expanded', async () => {
    const jobs = [
      sampleJob({ jobId: 'job-new', createdAt: '2026-08-10T06:56:00.000Z' }),
      sampleJob({ jobId: 'job-old', createdAt: '2026-08-09T17:31:00.000Z' }),
    ];
    const controller = createController({
      listJobs: vi.fn().mockResolvedValue({ items: jobs }),
    });
    await controller.initialize();
    const toggle = history.querySelector('#job-history-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(controller.isHistoryExpanded()).toBe(true);
    expect(history.querySelectorAll('tbody tr')).toHaveLength(2);
    const toggleAfter = history.querySelector('#job-history-toggle') as HTMLButtonElement;
    expect(toggleAfter.getAttribute('aria-expanded')).toBe('true');
  });

  it('does not start a second job when same-scope analysis is already active', async () => {
    const running = sampleJob({
      jobId: 'job-run',
      status: 'RUNNING',
      stage: 'DISCOVERY',
      createdAt: '2026-08-10T06:56:00.000Z',
      isScopeBlocking: true,
    });
    const completed = sampleJob({
      jobId: 'job-done',
      status: 'SUCCEEDED',
      stage: 'COMPLETE',
      createdAt: '2026-08-09T12:00:00.000Z',
    });
    const startJob = vi.fn();
    const getJob = vi.fn().mockResolvedValue(running);
    const controller = createController({
      startJob,
      getJob,
      listJobs: vi.fn().mockResolvedValue({ items: [running, completed] }),
    });
    await controller.initialize();
    await controller.startAnalysisFromUi();
    expect(startJob).not.toHaveBeenCalled();
    expect(controller.getActiveJobId()).toBe('job-run');
    expect(controller.getSelectedJobId()).toBe('job-run');
  });

  it('allows new analysis when same-scope RUNNING job is not scope-blocking', async () => {
    const stale = sampleJob({
      jobId: 'job-stale',
      status: 'RUNNING',
      stage: 'DISCOVERY',
      isScopeBlocking: false,
    });
    const startJob = vi.fn().mockResolvedValue({
      jobId: 'job-new',
      status: 'QUEUED',
      queueStatus: 'ENQUEUED',
      correlationId: 'c-new',
    });
    const getJob = vi.fn().mockResolvedValue(sampleJob({ jobId: 'job-new' }));
    const controller = createController({
      startJob,
      getJob,
      listJobs: vi.fn().mockResolvedValue({ items: [stale] }),
    });
    await controller.initialize();
    await controller.startAnalysisFromUi();
    expect(startJob).toHaveBeenCalledTimes(1);
    expect(controller.getActiveJobId()).toBe('job-new');
  });

  it('latest failed job remains the default latest row', async () => {
    const jobs = [
      sampleJob({
        jobId: 'failed-new',
        createdAt: '2026-08-10T06:56:00.000Z',
        status: 'FAILED',
        stage: 'DISCOVERY',
      }),
      sampleJob({
        jobId: 'success-old',
        createdAt: '2026-08-09T12:00:00.000Z',
        status: 'SUCCEEDED',
        stage: 'COMPLETE',
      }),
    ];
    const controller = createController({
      listJobs: vi.fn().mockResolvedValue({ items: jobs }),
    });
    await controller.initialize();
    expect(history.textContent).toContain('Failed');
    expect(history.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('does not offer View active analysis for stale non-blocking RUNNING job', async () => {
    const stale = sampleJob({
      jobId: 'job-stale',
      status: 'RUNNING',
      stage: 'DISCOVERY',
      isScopeBlocking: false,
    });
    const completed = sampleJob({
      jobId: 'job-done',
      status: 'SUCCEEDED',
      stage: 'COMPLETE',
      createdAt: '2026-08-10T06:56:00.000Z',
    });
    const getJob = vi.fn(async (id: string) => (id === 'job-stale' ? stale : completed));
    const controller = createController({
      getJob,
      listJobs: vi.fn().mockResolvedValue({ items: [completed, stale] }),
    });
    await controller.initialize();
    controller['activeJobId'] = 'job-stale';
    controller['activeJob'] = stale;
    await controller.viewJobProgress('job-done');
    expect(progress.textContent).not.toContain('View active analysis');
  });

  it('shows execution inactive copy when inspecting stale RUNNING job', async () => {
    const stale = sampleJob({
      jobId: 'job-stale',
      status: 'RUNNING',
      stage: 'DISCOVERY',
      isScopeBlocking: false,
    });
    const getJob = vi.fn(async () => stale);
    const controller = createController({
      getJob,
      listJobs: vi.fn().mockResolvedValue({ items: [stale] }),
    });
    await controller.initialize();
    await controller.viewJobProgress('job-stale');
    expect(progress.textContent).toContain('Execution: No longer active');
  });

  it('updates latest history row when active job poll reaches SUCCEEDED', async () => {
    vi.useFakeTimers();
    const jobId = 'job-idem-terminal';
    const queued = sampleJob({ jobId, status: 'QUEUED', stage: 'ENQUEUE' });
    const succeeded = sampleJob({
      jobId,
      status: 'SUCCEEDED',
      stage: 'COMPLETE',
      completedAt: '2026-08-10T18:28:01.000Z',
    });
    const getJob = vi
      .fn()
      .mockResolvedValueOnce(queued)
      .mockResolvedValue(succeeded);
    let listCall = 0;
    let listResolve: (value: { items: Ec2AsyncJob[] }) => void = () => {};
    const listJobs = vi.fn(async () => {
      listCall += 1;
      if (listCall === 1) {
        return { items: [] };
      }
      return new Promise<{ items: Ec2AsyncJob[] }>((resolve) => {
        listResolve = resolve;
      });
    });
    const startJob = vi.fn().mockResolvedValue({
      jobId,
      status: 'QUEUED',
      queueStatus: 'ENQUEUED',
      correlationId: 'c1',
    });
    const controller = createController({ startJob, getJob, listJobs });
    await controller.initialize();
    void controller.startAnalysisFromUi();
    await vi.advanceTimersByTimeAsync(0);
    listResolve({ items: [queued] });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(progress.textContent).toContain('Completed');
    expect(history.textContent).toContain('Completed');
    expect(controller.getHistoryItems().find((j) => j.jobId === jobId)?.status).toBe(
      'SUCCEEDED',
    );
    expect(controller.getHistoryItems().filter((j) => j.jobId === jobId)).toHaveLength(1);
    vi.useRealTimers();
  });

  it('ignores stale post-start list refresh that would regress terminal row', async () => {
    vi.useFakeTimers();
    const jobId = 'job-race';
    const queued = sampleJob({ jobId, status: 'QUEUED', stage: 'ENQUEUE' });
    const succeeded = sampleJob({
      jobId,
      status: 'SUCCEEDED',
      stage: 'COMPLETE',
      completedAt: '2026-08-10T18:28:01.000Z',
    });
    const getJob = vi
      .fn()
      .mockResolvedValueOnce(queued)
      .mockResolvedValue(succeeded);
    let listCall = 0;
    const listResolvers: Array<(value: { items: Ec2AsyncJob[] }) => void> = [];
    const listJobs = vi.fn(async () => {
      listCall += 1;
      if (listCall === 1) {
        return { items: [] };
      }
      return new Promise<{ items: Ec2AsyncJob[] }>((resolve) => {
        listResolvers.push(resolve);
      });
    });
    const startJob = vi.fn().mockResolvedValue({
      jobId,
      status: 'QUEUED',
      queueStatus: 'ENQUEUED',
      correlationId: 'c1',
    });
    const controller = createController({ startJob, getJob, listJobs });
    await controller.initialize();
    void controller.startAnalysisFromUi();
    await vi.advanceTimersByTimeAsync(0);
    expect(listJobs.mock.calls.length).toBeGreaterThanOrEqual(2);
    const terminalListIndex = listResolvers.length - 1;
    const startListIndex = 0;
    listResolvers[terminalListIndex]?.({ items: [succeeded] });
    await vi.advanceTimersByTimeAsync(0);
    expect(history.textContent).toContain('Completed');
    listResolvers[startListIndex]?.({ items: [queued] });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getHistoryItems().find((j) => j.jobId === jobId)?.status).toBe(
      'SUCCEEDED',
    );
    vi.useRealTimers();
  });

  it('calls refreshHistory again at terminal transition', async () => {
    vi.useFakeTimers();
    const jobId = 'job-refresh-count';
    const getJob = vi
      .fn()
      .mockResolvedValueOnce(sampleJob({ jobId, status: 'QUEUED', stage: 'ENQUEUE' }))
      .mockResolvedValue(
        sampleJob({
          jobId,
          status: 'SUCCEEDED',
          stage: 'COMPLETE',
          completedAt: '2026-08-10T18:28:01.000Z',
        }),
      );
    const listJobs = vi.fn().mockResolvedValue({ items: [] });
    const startJob = vi.fn().mockResolvedValue({
      jobId,
      status: 'QUEUED',
      queueStatus: 'ENQUEUED',
      correlationId: 'c1',
    });
    const controller = createController({ startJob, getJob, listJobs });
    await controller.initialize();
    await controller.startAnalysisFromUi();
    const callsAfterStart = listJobs.mock.calls.length;
    await vi.advanceTimersByTimeAsync(0);
    expect(listJobs.mock.calls.length).toBeGreaterThan(callsAfterStart);
    vi.useRealTimers();
  });

  it('updates history to Failed when active job poll fails', async () => {
    vi.useFakeTimers();
    const jobId = 'job-fail-active';
    const failed = sampleJob({
      jobId,
      status: 'FAILED',
      stage: 'DISCOVERY',
      errorSummary: 'Discovery failed safely',
    });
    const getJob = vi
      .fn()
      .mockResolvedValueOnce(sampleJob({ jobId, status: 'QUEUED', stage: 'ENQUEUE' }))
      .mockResolvedValue(failed);
    const listJobs = vi.fn().mockResolvedValue({ items: [] });
    const startJob = vi.fn().mockResolvedValue({
      jobId,
      status: 'QUEUED',
      queueStatus: 'ENQUEUED',
      correlationId: 'c1',
    });
    const controller = createController({ startJob, getJob, listJobs });
    await controller.initialize();
    await controller.startAnalysisFromUi();
    await vi.advanceTimersByTimeAsync(0);
    expect(history.textContent).toContain('Failed');
    expect(startJob).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('keeps selected historical progress when background active job completes', async () => {
    vi.useFakeTimers();
    const oldJob = sampleJob({
      jobId: 'job-old',
      status: 'SUCCEEDED',
      stage: 'COMPLETE',
      completedAt: '2026-08-09T12:00:00.000Z',
    });
    const newJobId = 'job-new-active';
    const succeededNew = sampleJob({
      jobId: newJobId,
      status: 'SUCCEEDED',
      stage: 'COMPLETE',
      completedAt: '2026-08-10T18:28:01.000Z',
    });
    const queuedNew = sampleJob({ jobId: newJobId, status: 'QUEUED', stage: 'ENQUEUE' });
    let newJobPolls = 0;
    const getJob = vi.fn(async (id: string) => {
      if (id === 'job-old') {
        return oldJob;
      }
      if (id === newJobId) {
        newJobPolls += 1;
        return newJobPolls === 1 ? queuedNew : succeededNew;
      }
      return sampleJob({ jobId: id, status: 'QUEUED', stage: 'ENQUEUE' });
    });
    const listJobs = vi.fn().mockResolvedValue({ items: [oldJob] });
    const startJob = vi.fn().mockResolvedValue({
      jobId: newJobId,
      status: 'QUEUED',
      queueStatus: 'ENQUEUED',
      correlationId: 'c-new',
    });
    const controller = createController({ startJob, getJob, listJobs });
    await controller.initialize();
    await controller.startAnalysisFromUi();
    await controller.viewJobProgress('job-old');
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSelectedJobId()).toBe('job-old');
    expect(controller.getDisplayJob()?.jobId).toBe('job-old');
    expect(controller.getHistoryItems().find((j) => j.jobId === newJobId)?.status).toBe(
      'SUCCEEDED',
    );
    vi.useRealTimers();
  });
});
