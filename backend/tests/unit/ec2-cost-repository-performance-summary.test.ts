import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';

describe('MockEc2CostRepository performance summary persistence', () => {
  it('persists performanceSummariesByRegion on completeRun and returns it from getRun', async () => {
    const repo = new MockEc2CostRepository();
    const created = await repo.createRun({
      runId: 'run-1',
      tenantId: 'tenant-a',
      accountId: '111122223333',
      regions: ['us-east-1'],
      observationDays: 14,
      periodSeconds: 3600,
      requestedAt: '2026-08-15T00:00:00.000Z',
      startedAt: '2026-08-15T00:00:00.000Z',
    });

    await repo.completeRun({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      runId: 'run-1',
      expectedVersion: created.version,
      status: 'SUCCEEDED',
      completedAt: '2026-08-15T01:00:00.000Z',
      instancesFound: 1,
      instancesEvaluated: 1,
      recommendationsCreated: 0,
      recommendationsUpdated: 0,
      recommendationsResolved: 0,
      insufficientDataCount: 0,
      regionsSucceeded: ['us-east-1'],
      regionsFailed: [],
      warnings: [],
      performanceSummariesByRegion: {
        'us-east-1': {
          availability: 'AVAILABLE',
          averageCpuUtilizationPercent: 4.27,
          instancesEvaluated: 1,
          instancesWithMetrics: 1,
          instancesIncludedInAverage: 1,
        },
      },
    });

    const stored = await repo.getRun('tenant-a', '111122223333', 'run-1');
    assert.equal(stored?.performanceSummariesByRegion?.['us-east-1']?.averageCpuUtilizationPercent, 4.27);
  });

  it('reads older runs without performanceSummariesByRegion safely', async () => {
    const repo = new MockEc2CostRepository();
    const created = await repo.createRun({
      runId: 'run-old',
      tenantId: 'tenant-a',
      accountId: '111122223333',
      regions: ['us-east-1'],
      observationDays: 14,
      periodSeconds: 3600,
      requestedAt: '2026-08-15T00:00:00.000Z',
      startedAt: '2026-08-15T00:00:00.000Z',
    });

    await repo.completeRun({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      runId: 'run-old',
      expectedVersion: created.version,
      status: 'SUCCEEDED',
      completedAt: '2026-08-15T01:00:00.000Z',
      instancesFound: 1,
      instancesEvaluated: 1,
      recommendationsCreated: 0,
      recommendationsUpdated: 0,
      recommendationsResolved: 0,
      insufficientDataCount: 0,
      regionsSucceeded: ['us-east-1'],
      regionsFailed: [],
      warnings: [],
    });

    const stored = await repo.getRun('tenant-a', '111122223333', 'run-old');
    assert.equal(stored?.performanceSummariesByRegion, undefined);
  });

  it('selects latest completed run scoped by tenant, account, and region', async () => {
    const repo = new MockEc2CostRepository();

    for (const [runId, completedAt] of [
      ['run-old', '2026-08-14T01:00:00.000Z'],
      ['run-new', '2026-08-15T01:00:00.000Z'],
    ] as const) {
      const created = await repo.createRun({
        runId,
        tenantId: 'tenant-a',
        accountId: '111122223333',
        regions: ['us-east-1', 'eu-west-1'],
        observationDays: 14,
        periodSeconds: 3600,
        requestedAt: completedAt,
        startedAt: completedAt,
      });
      await repo.completeRun({
        tenantId: 'tenant-a',
        accountId: '111122223333',
        runId,
        expectedVersion: created.version,
        status: 'SUCCEEDED',
        completedAt,
        instancesFound: 1,
        instancesEvaluated: 1,
        recommendationsCreated: 0,
        recommendationsUpdated: 0,
        recommendationsResolved: 0,
        insufficientDataCount: 0,
        regionsSucceeded: ['us-east-1'],
        regionsFailed: [],
        warnings: [],
        performanceSummariesByRegion: {
          'us-east-1': {
            availability: 'AVAILABLE',
            averageCpuUtilizationPercent: runId === 'run-new' ? 9 : 1,
            instancesEvaluated: 1,
            instancesWithMetrics: 1,
            instancesIncludedInAverage: 1,
          },
        },
      });
    }

    const latest = await repo.getLatestCompletedRun({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
    });

    assert.equal(latest?.runId, 'run-new');
    assert.equal(latest?.performanceSummariesByRegion?.['us-east-1']?.averageCpuUtilizationPercent, 9);

    const otherTenant = await repo.getLatestCompletedRun({
      tenantId: 'tenant-b',
      accountId: '111122223333',
      region: 'us-east-1',
    });
    assert.equal(otherTenant, null);

    const unrelatedRegion = await repo.getLatestCompletedRun({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'ap-southeast-1',
    });
    assert.equal(unrelatedRegion, null);
  });
});
