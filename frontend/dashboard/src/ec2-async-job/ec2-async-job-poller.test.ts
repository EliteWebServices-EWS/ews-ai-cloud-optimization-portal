import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Ec2AsyncJobPoller } from './ec2-async-job-poller';
import type { Ec2AsyncJob } from '../api/ec2-async-job-types';

function job(partial: Partial<Ec2AsyncJob> & Pick<Ec2AsyncJob, 'jobId' | 'status' | 'stage'>): Ec2AsyncJob {
  return {
    accountId: '111122223333',
    regions: ['us-east-1'],
    jobType: 'EC2_INTELLIGENCE',
    queueStatus: 'ENQUEUED',
    correlationId: 'corr',
    retryCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...partial,
  };
}

describe('Ec2AsyncJobPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls after start and stops on success', async () => {
    const fetchJob = vi
      .fn()
      .mockResolvedValueOnce(job({ jobId: 'j1', status: 'RUNNING', stage: 'DISCOVERY' }))
      .mockResolvedValueOnce(job({ jobId: 'j1', status: 'SUCCEEDED', stage: 'COMPLETE' }));
    const onTerminal = vi.fn();
    const poller = new Ec2AsyncJobPoller({
      jobId: 'j1',
      generation: 1,
      fetchJob,
      intervalMs: 3000,
      onUpdate: vi.fn(),
      onTerminal,
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchJob).toHaveBeenCalledTimes(2);
    expect(onTerminal).toHaveBeenCalledTimes(1);
  });

  it('does not overlap in-flight requests', async () => {
    let resolveFirst: (value: Ec2AsyncJob) => void = () => {};
    const first = new Promise<Ec2AsyncJob>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchJob = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue(job({ jobId: 'j1', status: 'SUCCEEDED', stage: 'COMPLETE' }));
    const poller = new Ec2AsyncJobPoller({
      jobId: 'j1',
      generation: 1,
      fetchJob,
      intervalMs: 1000,
      onUpdate: vi.fn(),
      onTerminal: vi.fn(),
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchJob).toHaveBeenCalledTimes(1);
    resolveFirst(job({ jobId: 'j1', status: 'RUNNING', stage: 'DISCOVERY' }));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchJob).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('keeps durable state on transient poll errors', async () => {
    const onPollError = vi.fn();
    const fetchJob = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(job({ jobId: 'j1', status: 'RUNNING', stage: 'DISCOVERY' }));
    const poller = new Ec2AsyncJobPoller({
      jobId: 'j1',
      generation: 1,
      fetchJob,
      intervalMs: 2000,
      onUpdate: vi.fn(),
      onTerminal: vi.fn(),
      onPollError,
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onPollError).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchJob.mock.calls.length).toBeGreaterThanOrEqual(2);
    poller.stop();
  });

  it('does not apply updates after stop (stale response)', async () => {
    const onUpdate = vi.fn();
    let resolvePending: (value: Ec2AsyncJob) => void = () => {};
    const fetchJob = vi.fn(
      () =>
        new Promise<Ec2AsyncJob>((resolve) => {
          resolvePending = resolve;
        }),
    );
    const poller = new Ec2AsyncJobPoller({
      jobId: 'j1',
      generation: 1,
      fetchJob,
      intervalMs: 1000,
      onUpdate,
      onTerminal: vi.fn(),
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    resolvePending(job({ jobId: 'j1', status: 'SUCCEEDED', stage: 'COMPLETE' }));
    await Promise.resolve();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('cleans up timers on stop', async () => {
    const fetchJob = vi
      .fn()
      .mockResolvedValue(job({ jobId: 'j1', status: 'RUNNING', stage: 'DISCOVERY' }));
    const poller = new Ec2AsyncJobPoller({
      jobId: 'j1',
      generation: 1,
      fetchJob,
      intervalMs: 5000,
      onUpdate: vi.fn(),
      onTerminal: vi.fn(),
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchJob).toHaveBeenCalledTimes(1);
    poller.stop();
    const callsBefore = fetchJob.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchJob.mock.calls.length).toBe(callsBefore);
  });
});
