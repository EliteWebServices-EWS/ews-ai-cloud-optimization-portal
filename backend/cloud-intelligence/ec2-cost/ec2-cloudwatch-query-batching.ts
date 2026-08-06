/** AWS CloudWatch GetMetricData — max MetricDataQueries per request (service quota). */
export const EC2_COST_MAX_METRIC_DATA_QUERIES_PER_REQUEST = 500;

export const EC2_COST_STANDARD_METRICS_PER_INSTANCE = 5;
export const EC2_COST_BURST_METRICS_PER_INSTANCE = 4;

export function metricQueriesPerInstance(instanceType?: string): number {
  const burstable = instanceType
    ? /^t[2-4][a-z]?\.|^t3\.|^t4g\./i.test(instanceType)
    : false;
  return burstable
    ? EC2_COST_STANDARD_METRICS_PER_INSTANCE + EC2_COST_BURST_METRICS_PER_INSTANCE
    : EC2_COST_STANDARD_METRICS_PER_INSTANCE;
}

export function estimateGetMetricDataCallsForInstances(
  instanceCount: number,
  burstable: boolean,
  maxQueriesPerRequest: number = EC2_COST_MAX_METRIC_DATA_QUERIES_PER_REQUEST,
): number {
  const qpi = burstable ? 9 : 5;
  const totalQueries = instanceCount * qpi;
  return Math.max(1, Math.ceil(totalQueries / maxQueriesPerRequest));
}

export function splitMetricDataQueryBatches<T>(
  queries: T[],
  maxPerBatch: number = EC2_COST_MAX_METRIC_DATA_QUERIES_PER_REQUEST,
): T[][] {
  if (queries.length === 0) {
    return [];
  }
  const limit = Math.max(1, maxPerBatch);
  const batches: T[][] = [];
  for (let i = 0; i < queries.length; i += limit) {
    batches.push(queries.slice(i, i + limit));
  }
  return batches;
}
