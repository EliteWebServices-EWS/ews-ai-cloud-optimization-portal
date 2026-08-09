/**
 * Timestamp and elapsed-time helpers for EC2 async jobs.
 */

export function formatJobTimestamp(iso: string | undefined): string {
  if (!iso || !iso.trim()) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString();
}

export function computeElapsedMs(
  job: {
    status: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
  },
  nowMs: number,
): number | null {
  const startIso = job.startedAt ?? job.createdAt;
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) {
    return null;
  }

  const terminal = job.status === 'SUCCEEDED' || job.status === 'PARTIAL' || job.status === 'FAILED';
  if (terminal) {
    const endIso = job.completedAt ?? job.startedAt ?? job.createdAt;
    const end = new Date(endIso).getTime();
    if (Number.isNaN(end)) {
      return null;
    }
    return Math.max(0, end - start);
  }

  return Math.max(0, nowMs - start);
}

export function formatElapsedDuration(ms: number | null): string {
  if (ms === null) {
    return '—';
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
