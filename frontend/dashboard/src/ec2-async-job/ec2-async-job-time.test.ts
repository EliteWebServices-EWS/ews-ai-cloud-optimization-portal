import { describe, it, expect } from 'vitest';
import { computeElapsedMs, formatElapsedDuration, formatJobTimestamp } from './ec2-async-job-time';

describe('ec2 async job time helpers', () => {
  it('formats missing timestamps as em dash', () => {
    expect(formatJobTimestamp(undefined)).toBe('—');
    expect(formatJobTimestamp('')).toBe('—');
  });

  it('computes active elapsed from startedAt', () => {
    const ms = computeElapsedMs(
      {
        status: 'RUNNING',
        createdAt: '2026-01-01T00:00:00.000Z',
        startedAt: '2026-01-01T00:10:00.000Z',
      },
      new Date('2026-01-01T00:11:00.000Z').getTime(),
    );
    expect(ms).toBe(60_000);
    expect(formatElapsedDuration(ms)).toBe('1m 0s');
  });

  it('computes terminal elapsed without updatedAt', () => {
    const ms = computeElapsedMs(
      {
        status: 'SUCCEEDED',
        createdAt: '2026-01-01T00:00:00.000Z',
        startedAt: '2026-01-01T00:05:00.000Z',
        completedAt: '2026-01-01T00:15:00.000Z',
      },
      Date.now(),
    );
    expect(ms).toBe(600_000);
  });
});
