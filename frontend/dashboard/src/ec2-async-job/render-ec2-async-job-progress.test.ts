import { describe, it, expect, beforeEach } from 'vitest';
import type { Ec2AsyncJob } from '../api/ec2-async-job-types';
import { renderEc2AsyncJobProgress } from './render-ec2-async-job-progress';

function sampleJob(overrides: Partial<Ec2AsyncJob> = {}): Ec2AsyncJob {
  return {
    jobId: 'job-hist-1',
    accountId: '111122223333',
    regions: ['us-east-1'],
    jobType: 'EC2_INTELLIGENCE',
    status: 'SUCCEEDED',
    queueStatus: 'ENQUEUED',
    stage: 'COMPLETE',
    correlationId: 'c1',
    retryCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:01:00.000Z',
    completedAt: '2026-01-01T00:10:00.000Z',
    version: 1,
    ...overrides,
  };
}

describe('renderEc2AsyncJobProgress', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
  });

  it('marks all eight steps complete for succeeded jobs', () => {
    renderEc2AsyncJobProgress(container, { job: sampleJob() });
    const steps = container.querySelectorAll('.progress-step');
    expect(steps).toHaveLength(8);
    steps.forEach((step) => {
      expect(step.classList.contains('step-completed')).toBe(true);
    });
  });

  it('shows created, started, and completed timestamps', () => {
    renderEc2AsyncJobProgress(container, { job: sampleJob() });
    expect(container.textContent).toContain('Created');
    expect(container.textContent).toContain('Started');
    expect(container.textContent).toContain('Completed');
    expect(container.textContent).toContain('job-hist-1');
  });

  it('represents failed stage and pending later steps', () => {
    renderEc2AsyncJobProgress(container, {
      job: sampleJob({
        status: 'FAILED',
        stage: 'DISCOVERY',
        errorSummary: 'Discovery timed out.',
        completedAt: '2026-01-01T00:05:00.000Z',
      }),
    });
    const steps = Array.from(container.querySelectorAll('.progress-step'));
    expect(steps[0]?.classList.contains('step-completed')).toBe(true);
    expect(steps[1]?.classList.contains('step-completed')).toBe(true);
    expect(steps[2]?.classList.contains('step-failed')).toBe(true);
    expect(steps[3]?.classList.contains('step-pending')).toBe(true);
    expect(steps[7]?.classList.contains('step-pending')).toBe(true);
    expect(container.textContent).toContain('Discovery timed out.');
    expect(container.textContent).toContain('Error:');
  });
});
