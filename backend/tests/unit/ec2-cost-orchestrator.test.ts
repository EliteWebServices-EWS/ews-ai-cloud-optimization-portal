import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Ec2CostAnalysisOrchestrator } from '../../cloud-intelligence/ec2-cost/ec2-cost-analysis-orchestrator';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import type { Ec2PerformanceMetricsClientPort } from '../../cloud-intelligence/ec2-cost/ec2-performance-metrics-client.port';

describe('Ec2CostAnalysisOrchestrator', () => {
  it('zero instances completes without calling CloudWatch', async () => {
    let metricsCalls = 0;
    const metricsFactory = () => {
      metricsCalls += 1;
      const port: Ec2PerformanceMetricsClientPort = {
        collectMetrics: async () => {
          throw new Error('CloudWatch should not be called');
        },
      };
      return port;
    };

    const resources = new MockEc2CloudResourceRepository();
    const costRepo = new MockEc2CostRepository();
    const orchestrator = new Ec2CostAnalysisOrchestrator(resources, costRepo, costRepo);

    const result = await orchestrator.run({
      tenantId: 't1',
      accountId: '111122223333',
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-zero',
      requestedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      metricsClientFactory: metricsFactory,
    });

    assert.equal(result.status, 'SUCCEEDED');
    assert.equal(result.instancesFound, 0);
    assert.equal(metricsCalls, 0);
    assert.ok(result.warnings.some((w) => w.includes('CloudWatch was not called')));
  });

  it('deduplicates findings on repeat analysis', async () => {
    const resources = new MockEc2CloudResourceRepository();
    await resources.upsertDiscoveredResource({
      tenantId: 't1',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-stopped',
      tags: [],
      status: 'ACTIVE',
      metadata: { state: 'stopped' },
      discoveredAt: new Date().toISOString(),
    });
    await resources.upsertDiscoveredResource({
      tenantId: 't1',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'VOLUME',
      resourceId: 'vol-1',
      tags: [],
      status: 'ACTIVE',
      metadata: { sizeGiB: 50, volumeType: 'gp3', attachments: [{ instanceId: 'i-stopped', state: 'attached' }] },
      discoveredAt: new Date().toISOString(),
    });

    const costRepo = new MockEc2CostRepository();
    const orchestrator = new Ec2CostAnalysisOrchestrator(resources, costRepo, costRepo);

    const base = {
      tenantId: 't1',
      accountId: '111122223333',
      regions: ['us-east-1'],
      observationDays: 14,
      metricsClientFactory: undefined,
    };

    const metricsFactory = () => ({
      collectMetrics: async () => [],
    });

    const first = await orchestrator.run({
      ...base,
      runId: 'run-1',
      requestedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      metricsClientFactory: metricsFactory,
    });
    assert.equal(first.recommendationsCreated, 1);

    const second = await orchestrator.run({
      ...base,
      runId: 'run-2',
      requestedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      metricsClientFactory: metricsFactory,
    });
    assert.equal(second.recommendationsUpdated, 1);
    assert.equal(second.recommendationsCreated, 0);
  });

  it('persists region performance summaries from collected evidence on completeRun', async () => {
    const resources = new MockEc2CloudResourceRepository();
    await resources.upsertDiscoveredResource({
      tenantId: 't1',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-running',
      tags: [],
      status: 'ACTIVE',
      metadata: { state: 'running', instanceType: 't3.micro' },
      discoveredAt: new Date().toISOString(),
    });

    const costRepo = new MockEc2CostRepository();
    const orchestrator = new Ec2CostAnalysisOrchestrator(resources, costRepo, costRepo);

    await orchestrator.run({
      tenantId: 't1',
      accountId: '111122223333',
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-metrics',
      requestedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      metricsClientFactory: () => ({
        collectMetrics: async () => [
          {
            tenantId: 't1',
            accountId: '111122223333',
            region: 'us-east-1',
            instanceId: 'i-running',
            observationStart: '2026-08-01T00:00:00.000Z',
            observationEnd: '2026-08-15T00:00:00.000Z',
            periodSeconds: 3600,
            expectedSampleCount: 336,
            actualSampleCount: 320,
            cpuAveragePercent: 4.27,
            dataCompleteness: 'COMPLETE',
            collectedAt: '2026-08-15T00:00:00.000Z',
            warnings: [],
          },
        ],
      }),
    });

    const stored = await costRepo.getRun('t1', '111122223333', 'run-metrics');
    assert.equal(stored?.performanceSummariesByRegion?.['us-east-1']?.availability, 'AVAILABLE');
    assert.equal(
      stored?.performanceSummariesByRegion?.['us-east-1']?.averageCpuUtilizationPercent,
      4.27,
    );
  });
});
