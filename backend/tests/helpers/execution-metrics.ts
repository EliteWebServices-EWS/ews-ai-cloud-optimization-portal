export interface LatencyStats {
  sampleCount: number;
  successes: number;
  failures: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index]!;
}

export function summarizeLatencies(
  samplesMs: number[],
  failures = 0,
): LatencyStats {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const mean =
    sorted.length === 0
      ? 0
      : sorted.reduce((sum, value) => sum + value, 0) / sorted.length;

  return {
    sampleCount: sorted.length,
    successes: sorted.length,
    failures,
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    meanMs: mean,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
  };
}

export function formatStats(label: string, stats: LatencyStats): string {
  return `[execution-perf] ${label} ${JSON.stringify(stats)}`;
}

export function resolveIterationCount(
  envVar = 'EXECUTION_VALIDATION_ITERATIONS',
  defaultCount = 50,
): number {
  const raw = process.env[envVar]?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : defaultCount;
  if (!Number.isInteger(parsed) || parsed < 1) {
    return defaultCount;
  }
  return Math.min(parsed, 500);
}
