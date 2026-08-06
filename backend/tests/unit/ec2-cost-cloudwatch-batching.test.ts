import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EC2_COST_MAX_METRIC_DATA_QUERIES_PER_REQUEST,
  estimateGetMetricDataCallsForInstances,
  splitMetricDataQueryBatches,
} from '../../cloud-intelligence/ec2-cost/ec2-cloudwatch-query-batching';
import {
  buildMetricDataQueriesForTargets,
  batchMetricDataQueries,
} from '../../cloud-intelligence/ec2-cost/ec2-cloudwatch-metric-queries';
import {
  mergeDatapointResults,
  sortedValuesFromSeries,
} from '../../cloud-intelligence/ec2-cost/ec2-cloudwatch-datapoint-merge';
import { createAwsCloudWatchEc2MetricsClient } from '../../cloud-intelligence/ec2-cost/aws-cloudwatch-ec2-metrics-client';
import { toEc2CostMetricsAppError } from '../../cloud-intelligence/ec2-cost/ec2-cost-metrics-errors';
import { Ec2CostAnalysisOrchestrator } from '../../cloud-intelligence/ec2-cost/ec2-cost-analysis-orchestrator';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import { buildEc2CostFindingKey } from '../../database/cloud-resources/ec2-cost-keys';
import { stoppedWithStorageRule } from '../../cloud-intelligence/ec2-cost/ec2-cost-rules';

describe('CloudWatch query batching', () => {
  it('below limit produces one batch and one GetMetricData call', async () => {
    const targets = [{ region: 'us-east-1', instanceId: 'i-1', instanceType: 'm5.large' }];
    const queries = buildMetricDataQueriesForTargets(targets, 3600);
    assert.equal(queries.length, 5);
    assert.equal(batchMetricDataQueries(queries).length, 1);

    let calls = 0;
    const client = createAwsCloudWatchEc2MetricsClient(
      {
        send: async () => {
          calls += 1;
          return { MetricDataResults: [] };
        },
      } as never,
      { tenantId: 't', accountId: '111122223333' },
    );
    await client.collectMetrics({
      region: 'us-east-1',
      targets,
      observationDays: 7,
      periodSeconds: 3600,
      endTime: new Date('2026-01-15T12:00:00.000Z'),
    });
    assert.equal(calls, 1);
  });

  it('exactly 500 queries uses one batch', () => {
    const targets = Array.from({ length: 100 }, (_, i) => ({
      region: 'us-east-1',
      instanceId: `i-${i}`,
      instanceType: 'm5.large',
    }));
    const queries = buildMetricDataQueriesForTargets(targets, 3600);
    assert.equal(queries.length, 500);
    assert.equal(batchMetricDataQueries(queries).length, 1);
    assert.equal(estimateGetMetricDataCallsForInstances(100, false), 1);
  });

  it('above 500 queries splits into two batches and two API calls', async () => {
    const targets = Array.from({ length: 101 }, (_, i) => ({
      region: 'us-east-1',
      instanceId: `i-${i}`,
      instanceType: 'm5.large',
    }));
    const queries = buildMetricDataQueriesForTargets(targets, 3600);
    assert.equal(queries.length, 505);
    assert.equal(batchMetricDataQueries(queries).length, 2);

    let calls = 0;
    const client = createAwsCloudWatchEc2MetricsClient(
      {
        send: async () => {
          calls += 1;
          return { MetricDataResults: [] };
        },
      } as never,
      { tenantId: 't', accountId: '111122223333' },
    );
    await client.collectMetrics({
      region: 'us-east-1',
      targets,
      observationDays: 7,
      periodSeconds: 3600,
      endTime: new Date('2026-01-15T12:00:00.000Z'),
    });
    assert.equal(calls, 2);
  });

  it('100 burstable instances require two GetMetricData batch calls', async () => {
    assert.equal(estimateGetMetricDataCallsForInstances(100, true), 2);
    const targets = Array.from({ length: 100 }, (_, i) => ({
      region: 'us-east-1',
      instanceId: `i-${i}`,
      instanceType: 't3.micro',
    }));
    assert.equal(buildMetricDataQueriesForTargets(targets, 3600).length, 900);
    let calls = 0;
    const client = createAwsCloudWatchEc2MetricsClient(
      {
        send: async () => {
          calls += 1;
          return { MetricDataResults: [] };
        },
      } as never,
      { tenantId: 't', accountId: '111122223333' },
    );
    await client.collectMetrics({
      region: 'us-east-1',
      targets,
      observationDays: 7,
      periodSeconds: 3600,
      endTime: new Date('2026-01-15T12:00:00.000Z'),
    });
    assert.equal(calls, 2);
  });

  it('every query id appears exactly once across batches', () => {
    const targets = Array.from({ length: 60 }, (_, i) => ({
      region: 'us-east-1',
      instanceId: `i-${i}`,
      instanceType: 't3.micro',
    }));
    const queries = buildMetricDataQueriesForTargets(targets, 3600);
    const ids = queries.map((q) => q.Id);
    const batched = batchMetricDataQueries(queries, 100);
    const flat = batched.flat().map((q) => q.Id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(flat.sort(), ids.sort());
  });

  it('NextToken pagination runs per batch', async () => {
    let calls = 0;
    const client = createAwsCloudWatchEc2MetricsClient(
      {
        send: async (cmd: { input?: { NextToken?: string } }) => {
          calls += 1;
          if (!cmd.input?.NextToken) {
            return {
              NextToken: 'page-2',
              MetricDataResults: [
                {
                  Id: 'i_0_CPUUtilization',
                  Values: [1],
                  Timestamps: [new Date('2026-01-01T00:00:00.000Z')],
                },
              ],
            };
          }
          return {
            MetricDataResults: [
              {
                Id: 'i_0_CPUUtilization',
                Values: [3],
                Timestamps: [new Date('2026-01-02T00:00:00.000Z')],
              },
            ],
          };
        },
      } as never,
      { tenantId: 't', accountId: '111122223333' },
    );
    const evidence = await client.collectMetrics({
      region: 'us-east-1',
      targets: [{ region: 'us-east-1', instanceId: 'i-0', instanceType: 'm5.large' }],
      observationDays: 7,
      periodSeconds: 3600,
      endTime: new Date('2026-01-15T12:00:00.000Z'),
    });
    assert.equal(calls, 2);
    assert.equal(evidence[0]?.cpuAveragePercent, 2);
  });

  it('deduplicates duplicate timestamps and sorts before statistics', () => {
    const seriesById = new Map();
    const t1 = new Date('2026-01-02T00:00:00.000Z');
    const t2 = new Date('2026-01-01T00:00:00.000Z');
    mergeDatapointResults(seriesById, 'm1', [t1, t2, t1], [10, 5, 99]);
    const sorted = sortedValuesFromSeries(seriesById.get('m1'));
    assert.deepEqual(sorted, [5, 99]);
  });

  it('AccessDenied from batch is sanitized', () => {
    const err = toEc2CostMetricsAppError(Object.assign(new Error('secret'), { name: 'AccessDenied' }));
    assert.equal(err.code, 'CLOUDWATCH_ACCESS_DENIED');
    assert.doesNotMatch(err.message, /secret/);
  });

  it('Throttling from batch maps to retryable CLOUDWATCH_THROTTLED', () => {
    const err = toEc2CostMetricsAppError(
      Object.assign(new Error('rate exceeded internal'), { name: 'ThrottlingException' }),
    );
    assert.equal(err.code, 'CLOUDWATCH_THROTTLED');
    assert.equal(err.statusCode, 429);
    assert.doesNotMatch(err.message, /rate exceeded internal/);
  });

  it('partial batch failure does not resolve recommendations', async () => {
    const resources = new MockEc2CloudResourceRepository();
    const costRepo = new MockEc2CostRepository();
    costRepo.seedRecommendation({
      recommendationId: 'rec-open',
      tenantId: 't',
      accountId: '111122223333',
      region: 'us-east-1',
      service: 'ec2',
      resourceType: 'INSTANCE',
      resourceId: 'i-gone',
      category: 'STOPPED_WITH_STORAGE',
      severity: 'MEDIUM',
      confidenceScore: 0.5,
      confidenceLevel: 'MEDIUM',
      title: 't',
      summary: 's',
      businessJustification: 'b',
      recommendedAction: 'r',
      evidenceSummary: 'e',
      observedValues: {},
      thresholds: {},
      pricingStatus: 'UNAVAILABLE',
      analysisRunId: 'old',
      ruleId: stoppedWithStorageRule.ruleId,
      ruleVersion: stoppedWithStorageRule.ruleVersion,
      lifecycleStatus: 'OPEN',
      findingKey: buildEc2CostFindingKey({
        tenantId: 't',
        accountId: '111122223333',
        region: 'us-east-1',
        resourceId: 'i-gone',
        category: 'STOPPED_WITH_STORAGE',
        ruleVersion: stoppedWithStorageRule.ruleVersion,
      }),
      firstDetectedAt: '2026-01-01T00:00:00.000Z',
      lastDetectedAt: '2026-01-01T00:00:00.000Z',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await resources.upsertDiscoveredResource({
      tenantId: 't',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-run',
      tags: [],
      status: 'ACTIVE',
      metadata: { state: 'running', instanceType: 't3.micro' },
      discoveredAt: new Date().toISOString(),
    });

    const orchestrator = new Ec2CostAnalysisOrchestrator(resources, costRepo, costRepo);
    const result = await orchestrator.run({
      tenantId: 't',
      accountId: '111122223333',
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-partial-batch',
      requestedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      metricsClientFactory: () => ({
        collectMetrics: async () => {
          throw Object.assign(new Error('denied'), { name: 'AccessDenied' });
        },
      }),
    });
    assert.equal(result.status, 'FAILED');
    assert.equal(result.recommendationsResolved, 0);
    const stillOpen = await costRepo.getRecommendation('t', '111122223333', 'rec-open');
    assert.equal(stillOpen?.lifecycleStatus, 'OPEN');
  });

  it('credentials and metadata never appear in evidence output', async () => {
    const client = createAwsCloudWatchEc2MetricsClient(
      {
        send: async () => ({
          $metadata: { requestId: 'req-123' },
          MetricDataResults: [{ Id: 'i_0_CPUUtilization', Values: [1], Timestamps: [new Date()] }],
        }),
      } as never,
      { tenantId: 't', accountId: '111122223333' },
    );
    const evidence = await client.collectMetrics({
      region: 'us-east-1',
      targets: [{ region: 'us-east-1', instanceId: 'i-0' }],
      observationDays: 7,
      periodSeconds: 3600,
      endTime: new Date('2026-01-15T12:00:00.000Z'),
    });
    const json = JSON.stringify(evidence);
    assert.doesNotMatch(json, /\$metadata|requestId|accessKey|sessionToken/i);
  });
});

describe('splitMetricDataQueryBatches helper', () => {
  it('uses centralized 500 default', () => {
    const items = Array.from({ length: EC2_COST_MAX_METRIC_DATA_QUERIES_PER_REQUEST + 1 }, (_, i) => i);
    assert.equal(splitMetricDataQueryBatches(items).length, 2);
  });
});
