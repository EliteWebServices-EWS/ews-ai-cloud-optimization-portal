/** Timestamp-indexed series; duplicate timestamps keep the latest value. */
export type DatapointSeries = Map<number, number>;

export function mergeDatapointResults(
  seriesById: Map<string, DatapointSeries>,
  metricId: string,
  timestamps: Date[] | undefined,
  values: number[] | undefined,
): void {
  if (!timestamps || !values || timestamps.length === 0) {
    return;
  }
  let series = seriesById.get(metricId);
  if (!series) {
    series = new Map();
    seriesById.set(metricId, series);
  }
  const len = Math.min(timestamps.length, values.length);
  for (let i = 0; i < len; i += 1) {
    const ts = timestamps[i]?.getTime();
    const value = values[i];
    if (ts === undefined || !Number.isFinite(value)) {
      continue;
    }
    series.set(ts, value);
  }
}

export function sortedValuesFromSeries(series: DatapointSeries | undefined): number[] {
  if (!series || series.size === 0) {
    return [];
  }
  return [...series.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => value);
}
