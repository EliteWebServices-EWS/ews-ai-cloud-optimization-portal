import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MockAwsAccountRepository } from '../../repositories/mock/mock-aws-account-repository';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import { Ec2CostAnalysisApiService } from '../../services/ec2-cost-analysis-api-service';

describe('Ec2CostAnalysisApiService performance summary projection', () => {
  it('returns latest region-scoped performanceSummary on cost recommendation list', async () => {
    const awsAccounts = new MockAwsAccountRepository();
    const resources = new MockEc2CloudResourceRepository();
    const costRepo = new MockEc2CostRepository();

    const created = await costRepo.createRun({
      runId: 'run-latest',
      tenantId: 'tenant-a',
      accountId: '111122223333',
      regions: ['us-east-1'],
      observationDays: 14,
      periodSeconds: 3600,
      requestedAt: '2026-08-15T00:00:00.000Z',
      startedAt: '2026-08-15T00:00:00.000Z',
    });
    await costRepo.completeRun({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      runId: 'run-latest',
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
          observationStart: '2026-08-01T00:00:00.000Z',
          observationEnd: '2026-08-15T00:00:00.000Z',
        },
      },
    });

    const service = new Ec2CostAnalysisApiService(awsAccounts, resources, costRepo, costRepo);
    const page = await service.listRecommendationsWithPerformanceSummary({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
    });

    assert.equal(page.performanceSummary?.availability, 'AVAILABLE');
    assert.equal(page.performanceSummary?.averageCpuUtilizationPercent, 4.27);
    assert.equal(page.performanceSummary?.analysisRunId, 'run-latest');
    assert.equal(page.performanceSummary?.analyzedAt, '2026-08-15T01:00:00.000Z');
  });

  it('returns UNAVAILABLE projection for older runs without stored summaries', async () => {
    const costRepo = new MockEc2CostRepository();
    const created = await costRepo.createRun({
      runId: 'run-old',
      tenantId: 'tenant-a',
      accountId: '111122223333',
      regions: ['us-east-1'],
      observationDays: 14,
      periodSeconds: 3600,
      requestedAt: '2026-08-15T00:00:00.000Z',
      startedAt: '2026-08-15T00:00:00.000Z',
    });
    await costRepo.completeRun({
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

    const service = new Ec2CostAnalysisApiService(
      new MockAwsAccountRepository(),
      new MockEc2CloudResourceRepository(),
      costRepo,
      costRepo,
    );
    const page = await service.listRecommendationsWithPerformanceSummary({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
    });

    assert.equal(page.performanceSummary?.availability, 'UNAVAILABLE');
    assert.equal(page.performanceSummary?.averageCpuUtilizationPercent, undefined);
  });
});
