import {
  GetMetricDataCommand,
  type CloudWatchClient,
} from '@aws-sdk/client-cloudwatch';

import { EC2_COST_DEFAULT_PERIOD_SECONDS } from './ec2-cost-limits';
import type {
  Ec2MetricsCollectionRequest,
  Ec2PerformanceMetricsClientPort,
} from './ec2-performance-metrics-client.port';
import type { Ec2PerformanceEvidence } from './ec2-cost-models';
import { average, maximum, minimum, p95, sum } from './ec2-metric-stats';
import {
  mergeDatapointResults,
  sortedValuesFromSeries,
  type DatapointSeries,
} from './ec2-cloudwatch-datapoint-merge';
import {
  batchMetricDataQueries,
  buildMetricDataQueriesForTargets,
  metricId,
  METRIC_CPU,
  METRIC_NET_IN,
  METRIC_NET_OUT,
  METRIC_STATUS_FAILED,
} from './ec2-cloudwatch-metric-queries';
import { EC2_COST_MAX_METRIC_DATA_QUERIES_PER_REQUEST } from './ec2-cloudwatch-query-batching';
import { logEc2CostCloudWatchMetricsFailure } from './ec2-cost-metrics-error-diagnostics';
import { toEc2CostMetricsAppError } from './ec2-cost-metrics-errors';
import { createLogger, type Logger } from '../../shared/utils';

export interface AwsCloudWatchEc2MetricsClientOptions {
  maxMetricDataQueriesPerRequest?: number;
  logger?: Logger;
}

async function fetchBatchMetricSeries(
  cloudWatch: CloudWatchClient,
  input: {
    startTime: Date;
    endTime: Date;
    queries: NonNullable<GetMetricDataCommand['input']['MetricDataQueries']>;
  },
  seriesById: Map<string, DatapointSeries>,
): Promise<void> {
  let nextToken: string | undefined;
  do {
    const response = await cloudWatch.send(
      new GetMetricDataCommand({
        StartTime: input.startTime,
        EndTime: input.endTime,
        MetricDataQueries: input.queries,
        NextToken: nextToken,
      }),
    );
    for (const result of response.MetricDataResults ?? []) {
      if (!result.Id) {
        continue;
      }
      mergeDatapointResults(
        seriesById,
        result.Id,
        result.Timestamps,
        result.Values?.map((v) => Number(v)),
      );
    }
    nextToken = response.NextToken;
  } while (nextToken);
}

export function createAwsCloudWatchEc2MetricsClient(
  cloudWatch: CloudWatchClient,
  context: { tenantId: string; accountId: string },
  options: AwsCloudWatchEc2MetricsClientOptions = {},
): Ec2PerformanceMetricsClientPort {
  const maxQueriesPerRequest =
    options.maxMetricDataQueriesPerRequest ?? EC2_COST_MAX_METRIC_DATA_QUERIES_PER_REQUEST;
  const logger = options.logger ?? createLogger('Ec2CostMetrics');

  return {
    async collectMetrics(request: Ec2MetricsCollectionRequest): Promise<Ec2PerformanceEvidence[]> {
      if (request.targets.length === 0) {
        return [];
      }

      const endTime = request.endTime;
      const startTime = new Date(
        endTime.getTime() - request.observationDays * 24 * 60 * 60 * 1000,
      );
      const period = request.periodSeconds || EC2_COST_DEFAULT_PERIOD_SECONDS;
      const expectedSampleCount = Math.max(
        1,
        Math.floor((endTime.getTime() - startTime.getTime()) / (period * 1000)),
      );

      const allQueries = buildMetricDataQueriesForTargets(request.targets, period);
      const batches = batchMetricDataQueries(allQueries, maxQueriesPerRequest);
      const seriesById = new Map<string, DatapointSeries>();

      for (const queryBatch of batches) {
        try {
          await fetchBatchMetricSeries(cloudWatch, {
            startTime,
            endTime,
            queries: queryBatch,
          }, seriesById);
        } catch (error) {
          const mapped = toEc2CostMetricsAppError(error);
          logEc2CostCloudWatchMetricsFailure(
            logger,
            {
              operation: 'GetMetricData',
              region: request.region,
              tenantId: context.tenantId,
              accountId: context.accountId,
              mappedCode: mapped.code,
            },
            error,
          );
          throw mapped;
        }
      }

      const collectedAt = new Date().toISOString();
      return request.targets.map((target) => {
        const cpuAvgSeries = sortedValuesFromSeries(
          seriesById.get(metricId(target.instanceId, METRIC_CPU)),
        );
        const cpuMaxSeries = sortedValuesFromSeries(
          seriesById.get(metricId(target.instanceId, `${METRIC_CPU}_max`)),
        );
        const actualSampleCount = cpuAvgSeries.length;
        let dataCompleteness: Ec2PerformanceEvidence['dataCompleteness'] = 'NO_DATA';
        if (actualSampleCount === 0) {
          dataCompleteness = 'NO_DATA';
        } else if (actualSampleCount >= expectedSampleCount * 0.9) {
          dataCompleteness = 'COMPLETE';
        } else if (actualSampleCount >= expectedSampleCount * 0.5) {
          dataCompleteness = 'PARTIAL';
        } else {
          dataCompleteness = 'INSUFFICIENT';
        }

        return {
          tenantId: context.tenantId,
          accountId: context.accountId,
          region: request.region,
          instanceId: target.instanceId,
          observationStart: startTime.toISOString(),
          observationEnd: endTime.toISOString(),
          periodSeconds: period,
          expectedSampleCount,
          actualSampleCount,
          cpuAveragePercent: average(cpuAvgSeries),
          cpuMaximumPercent: maximum(cpuMaxSeries),
          cpuP95Percent: p95(cpuAvgSeries),
          networkInAverageBytes: average(
            sortedValuesFromSeries(seriesById.get(metricId(target.instanceId, METRIC_NET_IN))),
          ),
          networkOutAverageBytes: average(
            sortedValuesFromSeries(seriesById.get(metricId(target.instanceId, METRIC_NET_OUT))),
          ),
          statusCheckFailureCount: sum(
            sortedValuesFromSeries(seriesById.get(metricId(target.instanceId, METRIC_STATUS_FAILED))),
          ),
          cpuCreditBalanceMinimum: minimum(
            sortedValuesFromSeries(seriesById.get(metricId(target.instanceId, 'CPUCreditBalance'))),
          ),
          cpuCreditUsageAverage: average(
            sortedValuesFromSeries(seriesById.get(metricId(target.instanceId, 'CPUCreditUsage'))),
          ),
          surplusCreditsChargedTotal: sum(
            sortedValuesFromSeries(
              seriesById.get(metricId(target.instanceId, 'CPUSurplusCreditsCharged')),
            ),
          ),
          dataCompleteness,
          collectedAt,
          warnings: [],
        };
      });
    },
  };
}
