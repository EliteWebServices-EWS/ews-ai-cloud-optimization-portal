import type { GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';

import {
  EC2_COST_MAX_METRIC_DATA_QUERIES_PER_REQUEST,
  splitMetricDataQueryBatches,
} from './ec2-cloudwatch-query-batching';
import type { Ec2MetricsCollectionTarget } from './ec2-performance-metrics-client.port';

const AWS_ECU_NAMESPACE = 'AWS/EC2';
const METRIC_CPU = 'CPUUtilization';
const METRIC_NET_IN = 'NetworkIn';
const METRIC_NET_OUT = 'NetworkOut';
const METRIC_STATUS_FAILED = 'StatusCheckFailed';
const BURST_METRICS = [
  'CPUCreditBalance',
  'CPUCreditUsage',
  'CPUSurplusCreditBalance',
  'CPUSurplusCreditsCharged',
] as const;

export function isBurstableInstanceType(instanceType?: string): boolean {
  if (!instanceType) {
    return false;
  }
  return /^t[2-4][a-z]?\.|^t3\.|^t4g\./i.test(instanceType);
}

export function metricId(instanceId: string, metricName: string): string {
  return `${instanceId}_${metricName}`.replace(/[^a-zA-Z0-9_]/g, '_');
}

export type MetricDataQueryInput = NonNullable<GetMetricDataCommand['input']['MetricDataQueries']>[number];

export function buildMetricDataQueriesForTargets(
  targets: Ec2MetricsCollectionTarget[],
  period: number,
): MetricDataQueryInput[] {
  const metricQueries: MetricDataQueryInput[] = [];
  for (const target of targets) {
    const dim = [{ Name: 'InstanceId', Value: target.instanceId }];
    const base = {
      ReturnData: true,
      Period: period,
    };
    metricQueries.push({
      Id: metricId(target.instanceId, METRIC_CPU),
      MetricStat: {
        Metric: { Namespace: AWS_ECU_NAMESPACE, MetricName: METRIC_CPU, Dimensions: dim },
        Period: period,
        Stat: 'Average',
      },
      ...base,
    });
    metricQueries.push({
      Id: metricId(target.instanceId, `${METRIC_CPU}_max`),
      MetricStat: {
        Metric: { Namespace: AWS_ECU_NAMESPACE, MetricName: METRIC_CPU, Dimensions: dim },
        Period: period,
        Stat: 'Maximum',
      },
      ...base,
    });
    metricQueries.push({
      Id: metricId(target.instanceId, METRIC_NET_IN),
      MetricStat: {
        Metric: { Namespace: AWS_ECU_NAMESPACE, MetricName: METRIC_NET_IN, Dimensions: dim },
        Period: period,
        Stat: 'Average',
      },
      ...base,
    });
    metricQueries.push({
      Id: metricId(target.instanceId, METRIC_NET_OUT),
      MetricStat: {
        Metric: { Namespace: AWS_ECU_NAMESPACE, MetricName: METRIC_NET_OUT, Dimensions: dim },
        Period: period,
        Stat: 'Average',
      },
      ...base,
    });
    metricQueries.push({
      Id: metricId(target.instanceId, METRIC_STATUS_FAILED),
      MetricStat: {
        Metric: {
          Namespace: AWS_ECU_NAMESPACE,
          MetricName: METRIC_STATUS_FAILED,
          Dimensions: dim,
        },
        Period: period,
        Stat: 'Sum',
      },
      ...base,
    });
    if (isBurstableInstanceType(target.instanceType)) {
      for (const burstName of BURST_METRICS) {
        metricQueries.push({
          Id: metricId(target.instanceId, burstName),
          MetricStat: {
            Metric: {
              Namespace: AWS_ECU_NAMESPACE,
              MetricName: burstName,
              Dimensions: dim,
            },
            Period: period,
            Stat: burstName.includes('Balance') ? 'Minimum' : 'Average',
          },
          ...base,
        });
      }
    }
  }
  return metricQueries;
}

export function batchMetricDataQueries(
  queries: MetricDataQueryInput[],
  maxPerBatch: number = EC2_COST_MAX_METRIC_DATA_QUERIES_PER_REQUEST,
): MetricDataQueryInput[][] {
  return splitMetricDataQueryBatches(queries, maxPerBatch);
}

export { METRIC_CPU, METRIC_NET_IN, METRIC_NET_OUT, METRIC_STATUS_FAILED, BURST_METRICS, AWS_ECU_NAMESPACE };
