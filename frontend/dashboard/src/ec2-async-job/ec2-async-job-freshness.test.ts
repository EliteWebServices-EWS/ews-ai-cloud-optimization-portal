import { describe, it, expect, beforeEach } from 'vitest';
import {
  consumeEc2AsyncJobCompletedSignal,
  markEc2AsyncJobCompleted,
  peekEc2AsyncJobCompletedSignal,
} from './ec2-async-job-freshness';

describe('ec2 async job freshness signal', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('marks and consumes completion signal once', () => {
    markEc2AsyncJobCompleted('job-123', '2026-01-01T12:00:00.000Z');
    expect(peekEc2AsyncJobCompletedSignal()?.jobId).toBe('job-123');
    const consumed = consumeEc2AsyncJobCompletedSignal();
    expect(consumed?.jobId).toBe('job-123');
    expect(consumeEc2AsyncJobCompletedSignal()).toBeNull();
  });
});
