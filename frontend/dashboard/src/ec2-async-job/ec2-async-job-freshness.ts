/**
 * Cross-page freshness signal after EC2 async job success (sessionStorage, same origin).
 * Reports page consumes this to re-fetch authoritative `/reports` data on open.
 */

const STORAGE_KEY = 'sisum.ec2AsyncJob.completed';

export interface Ec2AsyncJobCompletedSignal {
  jobId: string;
  completedAt: string;
}

export function markEc2AsyncJobCompleted(jobId: string, completedAt?: string): void {
  const payload: Ec2AsyncJobCompletedSignal = {
    jobId,
    completedAt: completedAt ?? new Date().toISOString(),
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function consumeEc2AsyncJobCompletedSignal(): Ec2AsyncJobCompletedSignal | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  sessionStorage.removeItem(STORAGE_KEY);
  try {
    const parsed = JSON.parse(raw) as Ec2AsyncJobCompletedSignal;
    if (typeof parsed.jobId !== 'string' || typeof parsed.completedAt !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function peekEc2AsyncJobCompletedSignal(): Ec2AsyncJobCompletedSignal | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as Ec2AsyncJobCompletedSignal;
  } catch {
    return null;
  }
}
