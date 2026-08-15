import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAwsCloudWatchEc2MetricsClient } from '../../cloud-intelligence/ec2-cost/aws-cloudwatch-ec2-metrics-client';
import type { Ec2PerformanceMetricsClientPort } from '../../cloud-intelligence/ec2-cost/ec2-performance-metrics-client.port';
import { AppError } from '../../shared/utils';

describe('AwsCloudWatchEc2MetricsClient', () => {
  it('batches multiple instances in one GetMetricData call', async () => {
    let queryCount = 0;
    const calls: unknown[] = [];
    const cloudWatch = {
      send: async (command: { input?: { MetricDataQueries?: { Id?: string }[] } }) => {
        queryCount += 1;
        calls.push(command.input);
        const ids = command.input?.MetricDataQueries?.map((q) => q.Id).filter(Boolean) ?? [];
        return {
          MetricDataResults: ids.map((id) => ({
            Id: id,
            Values: id?.includes('CPUUtilization_max') ? [20] : [3, 4, 5],
            Timestamps: [
              new Date('2026-01-01T00:00:00.000Z'),
              new Date('2026-01-02T00:00:00.000Z'),
              new Date('2026-01-03T00:00:00.000Z'),
            ],
          })),
        };
      },
    };

    const client: Ec2PerformanceMetricsClientPort = createAwsCloudWatchEc2MetricsClient(
      cloudWatch as never,
      { tenantId: 't1', accountId: '111122223333' },
    );

    const endTime = new Date('2026-01-15T12:00:00.000Z');
    const evidence = await client.collectMetrics({
      region: 'us-east-1',
      targets: [
        { region: 'us-east-1', instanceId: 'i-aaa', instanceType: 't3.micro' },
        { region: 'us-east-1', instanceId: 'i-bbb', instanceType: 'm5.large' },
      ],
      observationDays: 14,
      periodSeconds: 3600,
      endTime,
    });

    assert.equal(queryCount, 1);
    assert.equal(evidence.length, 2);
    assert.equal(evidence[0]?.instanceId, 'i-aaa');
    assert.equal(evidence[1]?.instanceId, 'i-bbb');
    assert.equal(evidence[0]?.cpuAveragePercent, 4);
    assert.ok((calls[0] as { MetricDataQueries: { MetricStat?: { Metric?: { Namespace?: string } } }[] }).MetricDataQueries.every(
      (q) => q.MetricStat?.Metric?.Namespace === 'AWS/EC2',
    ));
  });

  it('treats missing CPU series as NO_DATA not zero average', async () => {
    const cloudWatch = {
      send: async () => ({
        MetricDataResults: [],
      }),
    };
    const client = createAwsCloudWatchEc2MetricsClient(cloudWatch as never, {
      tenantId: 't1',
      accountId: '111122223333',
    });
    const evidence = await client.collectMetrics({
      region: 'us-east-1',
      targets: [{ region: 'us-east-1', instanceId: 'i-empty' }],
      observationDays: 14,
      periodSeconds: 3600,
      endTime: new Date('2026-01-15T12:00:00.000Z'),
    });
    assert.equal(evidence[0]?.dataCompleteness, 'NO_DATA');
    assert.equal(evidence[0]?.cpuAveragePercent, undefined);
  });

  it('includes burst metrics only for burstable instance types', async () => {
    const queriedIds: string[] = [];
    const cloudWatch = {
      send: async (command: { input?: { MetricDataQueries?: { Id?: string }[] } }) => {
        for (const q of command.input?.MetricDataQueries ?? []) {
          if (q.Id) {
            queriedIds.push(q.Id);
          }
        }
        return { MetricDataResults: [] };
      },
    };
    const client = createAwsCloudWatchEc2MetricsClient(cloudWatch as never, {
      tenantId: 't1',
      accountId: '111122223333',
    });
    await client.collectMetrics({
      region: 'us-east-1',
      targets: [
        { region: 'us-east-1', instanceId: 'i-t3', instanceType: 't3.micro' },
        { region: 'us-east-1', instanceId: 'i-m5', instanceType: 'm5.large' },
      ],
      observationDays: 7,
      periodSeconds: 3600,
      endTime: new Date('2026-01-15T12:00:00.000Z'),
    });
    assert.ok(queriedIds.some((id) => id.includes('CPUCreditBalance') && id.includes('i_t3')));
    assert.ok(!queriedIds.some((id) => id.includes('CPUCreditBalance') && id.includes('i_m5')));
  });

  it('follows NextToken pagination', async () => {
    let pages = 0;
    const cloudWatch = {
      send: async (command: { input?: { NextToken?: string; MetricDataQueries?: { Id?: string }[] } }) => {
        pages += 1;
        const id = command.input?.MetricDataQueries?.[0]?.Id ?? 'i_a_CPUUtilization';
        if (!command.input?.NextToken) {
          return {
            NextToken: 'token-2',
            MetricDataResults: [
              {
                Id: id,
                Values: [1],
                Timestamps: [new Date('2026-01-01T00:00:00.000Z')],
              },
            ],
          };
        }
        return {
          MetricDataResults: [
            {
              Id: id,
              Values: [3],
              Timestamps: [new Date('2026-01-02T00:00:00.000Z')],
            },
          ],
        };
      },
    };
    const client = createAwsCloudWatchEc2MetricsClient(cloudWatch as never, {
      tenantId: 't1',
      accountId: '111122223333',
    });
    const evidence = await client.collectMetrics({
      region: 'us-east-1',
      targets: [{ region: 'us-east-1', instanceId: 'i-a' }],
      observationDays: 7,
      periodSeconds: 3600,
      endTime: new Date('2026-01-15T12:00:00.000Z'),
    });
    assert.equal(pages, 2);
    assert.equal(evidence[0]?.cpuAveragePercent, 2);
  });

  it('preserves zero datapoints as zero average', async () => {
    const cloudWatch = {
      send: async (command: { input?: { MetricDataQueries?: { Id?: string }[] } }) => {
        const id = command.input?.MetricDataQueries?.find((q) => q.Id?.includes('CPUUtilization') && !q.Id.includes('max'))?.Id;
        return {
          MetricDataResults: [
            {
              Id: id,
              Values: [0, 0, 0],
              Timestamps: [
                new Date('2026-01-01T00:00:00.000Z'),
                new Date('2026-01-02T00:00:00.000Z'),
                new Date('2026-01-03T00:00:00.000Z'),
              ],
            },
          ],
        };
      },
    };
    const client = createAwsCloudWatchEc2MetricsClient(cloudWatch as never, {
      tenantId: 't1',
      accountId: '111122223333',
    });
    const evidence = await client.collectMetrics({
      region: 'us-east-1',
      targets: [{ region: 'us-east-1', instanceId: 'i-zero' }],
      observationDays: 7,
      periodSeconds: 3600,
      endTime: new Date('2026-01-15T12:00:00.000Z'),
    });
    assert.equal(evidence[0]?.cpuAveragePercent, 0);
    assert.notEqual(evidence[0]?.dataCompleteness, 'NO_DATA');
  });

  it('uses InstanceId dimension and observation window on request', async () => {
    let captured: { StartTime?: Date; EndTime?: Date; MetricDataQueries?: unknown[] } = {};
    const cloudWatch = {
      send: async (command: { input?: typeof captured }) => {
        captured = command.input ?? {};
        return { MetricDataResults: [] };
      },
    };
    const client = createAwsCloudWatchEc2MetricsClient(cloudWatch as never, {
      tenantId: 't1',
      accountId: '111122223333',
    });
    const endTime = new Date('2026-01-15T12:00:00.000Z');
    await client.collectMetrics({
      region: 'us-east-1',
      targets: [{ region: 'us-east-1', instanceId: 'i-dim' }],
      observationDays: 14,
      periodSeconds: 300,
      endTime,
    });
    const startMs = endTime.getTime() - 14 * 24 * 60 * 60 * 1000;
    assert.equal(captured.EndTime?.getTime(), endTime.getTime());
    assert.equal(captured.StartTime?.getTime(), startMs);
    const queries = captured.MetricDataQueries as { MetricStat?: { Period?: number; Metric?: { Dimensions?: { Name: string; Value: string }[] } } }[];
    assert.ok(queries.some((q) => q.MetricStat?.Metric?.Dimensions?.[0]?.Value === 'i-dim'));
    assert.ok(queries.every((q) => q.MetricStat?.Period === 300));
  });

  it('does not return raw metadata from CloudWatch client', async () => {
    const cloudWatch = {
      send: async () => ({
        $metadata: { requestId: 'secret-req' },
        MetricDataResults: [
          {
            Id: 'i_a_CPUUtilization',
            Values: [5],
            Timestamps: [new Date('2026-01-01T00:00:00.000Z')],
          },
        ],
      }),
    };
    const client = createAwsCloudWatchEc2MetricsClient(cloudWatch as never, {
      tenantId: 't1',
      accountId: '111122223333',
    });
    const evidence = await client.collectMetrics({
      region: 'us-east-1',
      targets: [{ region: 'us-east-1', instanceId: 'i-a' }],
      observationDays: 7,
      periodSeconds: 3600,
      endTime: new Date('2026-01-15T12:00:00.000Z'),
    });
    assert.equal(JSON.stringify(evidence).includes('requestId'), false);
    assert.equal(JSON.stringify(evidence).includes('$metadata'), false);
  });

  it('logs sanitized GetMetricData diagnostics and rethrows mapped AppError', async () => {
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (message?: unknown) => {
      logs.push(String(message));
    };

    try {
      const cloudWatch = {
        send: async () => {
          throw Object.assign(new Error('sensitive cloudwatch failure'), {
            name: 'ValidationException',
            $metadata: {
              httpStatusCode: 400,
              requestId: 'request-123',
              attempts: 1,
            },
            MetricDataQueries: [{ Id: 'secret-query' }],
          });
        },
      };
      const client = createAwsCloudWatchEc2MetricsClient(cloudWatch as never, {
        tenantId: 'tenant-a',
        accountId: '111122223333',
      });

      await assert.rejects(
        () =>
          client.collectMetrics({
            region: 'us-east-1',
            targets: [{ region: 'us-east-1', instanceId: 'i-fail' }],
            observationDays: 7,
            periodSeconds: 3600,
            endTime: new Date('2026-01-15T12:00:00.000Z'),
          }),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, 'CLOUDWATCH_METRICS_FAILED');
          return true;
        },
      );

      assert.equal(logs.length, 1);
      const payload = JSON.parse(logs[0] ?? '{}') as Record<string, unknown>;
      assert.equal(payload.scope, 'Ec2CostMetrics');
      assert.equal(payload.operation, 'GetMetricData');
      assert.equal(payload.region, 'us-east-1');
      assert.equal(payload.mappedCode, 'CLOUDWATCH_METRICS_FAILED');
      assert.equal(payload.awsErrorName, 'ValidationException');
      assert.equal(payload.awsHttpStatusCode, 400);
      assert.equal(payload.awsRequestId, 'request-123');
      assert.equal(JSON.stringify(payload).includes('sensitive cloudwatch failure'), false);
      assert.equal(JSON.stringify(payload).includes('secret-query'), false);
    } finally {
      console.error = originalError;
    }
  });
});
