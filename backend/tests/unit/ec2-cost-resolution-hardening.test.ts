import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  mergeRecommendationLifecycleOnUpsert,
  shouldResolveOpenRecommendation,
} from '../../cloud-intelligence/ec2-cost/ec2-cost-resolution-policy';
import { Ec2CostAnalysisOrchestrator } from '../../cloud-intelligence/ec2-cost/ec2-cost-analysis-orchestrator';
import { buildEc2CostFindingKey } from '../../database/cloud-resources/ec2-cost-keys';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import type { Ec2CostRecommendationRecord } from '../../cloud-intelligence/ec2-cost/ec2-cost-models';
import { stoppedWithStorageRule } from '../../cloud-intelligence/ec2-cost/ec2-cost-rules';

const TENANT = 't-res';
const ACCOUNT = '111122223333';

function openRec(overrides: Partial<Ec2CostRecommendationRecord>): Ec2CostRecommendationRecord {
  const region = overrides.region ?? 'us-east-1';
  const resourceId = overrides.resourceId ?? 'i-old';
  const category = overrides.category ?? 'STOPPED_WITH_STORAGE';
  const ruleVersion = overrides.ruleVersion ?? stoppedWithStorageRule.ruleVersion;
  const findingKey =
    overrides.findingKey ??
    buildEc2CostFindingKey({
      tenantId: TENANT,
      accountId: ACCOUNT,
      region,
      resourceId,
      category,
      ruleVersion,
    });
  return {
    recommendationId: 'rec-1',
    tenantId: TENANT,
    accountId: ACCOUNT,
    region,
    service: 'ec2',
    resourceType: 'INSTANCE',
    resourceId,
    category,
    severity: 'MEDIUM',
    confidenceScore: 0.5,
    confidenceLevel: 'MEDIUM',
    title: 't',
    summary: 's',
    businessJustification: 'b',
    recommendedAction: 'review',
    evidenceSummary: 'e',
    observedValues: {},
    thresholds: {},
    pricingStatus: 'UNAVAILABLE',
    analysisRunId: 'old-run',
    ruleId: stoppedWithStorageRule.ruleId,
    ruleVersion,
    lifecycleStatus: 'OPEN',
    findingKey,
    firstDetectedAt: '2026-01-01T00:00:00.000Z',
    lastDetectedAt: '2026-01-02T00:00:00.000Z',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('EC2 cost resolution policy', () => {
  it('SUCCEEDED equivalent scope resolves absent OPEN finding', () => {
    const rec = openRec({});
    const ctx = {
      runStatus: 'SUCCEEDED' as const,
      requestedRegions: ['us-east-1'],
      regionsFailed: [],
      seenFindingKeys: new Set<string>(),
      currentRuleVersions: new Map([[stoppedWithStorageRule.ruleId, stoppedWithStorageRule.ruleVersion]]),
    };
    assert.equal(shouldResolveOpenRecommendation(rec, ctx), true);
  });

  it('PARTIAL does not resolve', () => {
    const rec = openRec({});
    assert.equal(
      shouldResolveOpenRecommendation(rec, {
        runStatus: 'PARTIAL',
        requestedRegions: ['us-east-1'],
        regionsFailed: ['us-west-2'],
        seenFindingKeys: new Set(),
        currentRuleVersions: new Map([[stoppedWithStorageRule.ruleId, stoppedWithStorageRule.ruleVersion]]),
      }),
      false,
    );
  });

  it('FAILED does not resolve', () => {
    const rec = openRec({});
    assert.equal(
      shouldResolveOpenRecommendation(rec, {
        runStatus: 'FAILED',
        requestedRegions: ['us-east-1'],
        regionsFailed: ['us-east-1'],
        seenFindingKeys: new Set(),
        currentRuleVersions: new Map([[stoppedWithStorageRule.ruleId, stoppedWithStorageRule.ruleVersion]]),
      }),
      false,
    );
  });

  it('unanalyzed region is untouched', () => {
    const rec = openRec({ region: 'eu-west-1' });
    assert.equal(
      shouldResolveOpenRecommendation(rec, {
        runStatus: 'SUCCEEDED',
        requestedRegions: ['us-east-1'],
        regionsFailed: [],
        seenFindingKeys: new Set(),
        currentRuleVersions: new Map([[stoppedWithStorageRule.ruleId, stoppedWithStorageRule.ruleVersion]]),
      }),
      false,
    );
  });

  it('rule-version mismatch is untouched', () => {
    const rec = openRec({ ruleVersion: '0.1.0' });
    assert.equal(
      shouldResolveOpenRecommendation(rec, {
        runStatus: 'SUCCEEDED',
        requestedRegions: ['us-east-1'],
        regionsFailed: [],
        seenFindingKeys: new Set(),
        currentRuleVersions: new Map([[stoppedWithStorageRule.ruleId, '1.0.0']]),
      }),
      false,
    );
  });

  it('ACKNOWLEDGED lifecycle is preserved on upsert merge', () => {
    const existing = openRec({ lifecycleStatus: 'ACKNOWLEDGED' });
    assert.equal(mergeRecommendationLifecycleOnUpsert(existing, 'OPEN'), 'ACKNOWLEDGED');
  });

  it('DISMISSED lifecycle is preserved on upsert merge', () => {
    const existing = openRec({ lifecycleStatus: 'DISMISSED' });
    assert.equal(mergeRecommendationLifecycleOnUpsert(existing, 'OPEN'), 'DISMISSED');
  });

  it('RESOLVED reopens to OPEN on recurrence', () => {
    const existing = openRec({ lifecycleStatus: 'RESOLVED', resolvedAt: '2026-02-01T00:00:00.000Z' });
    assert.equal(mergeRecommendationLifecycleOnUpsert(existing, 'OPEN'), 'OPEN');
  });
});

describe('Ec2CostAnalysisOrchestrator resolution integration', () => {
  it('PARTIAL metric failure does not resolve OPEN findings', async () => {
    const resources = new MockEc2CloudResourceRepository();
    await resources.upsertDiscoveredResource({
      tenantId: TENANT,
      accountId: ACCOUNT,
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-run',
      tags: [],
      status: 'ACTIVE',
      metadata: { state: 'running', instanceType: 't3.micro' },
      discoveredAt: new Date().toISOString(),
    });
    await resources.upsertDiscoveredResource({
      tenantId: TENANT,
      accountId: ACCOUNT,
      region: 'us-west-2',
      resourceType: 'INSTANCE',
      resourceId: 'i-west',
      tags: [],
      status: 'ACTIVE',
      metadata: { state: 'running', instanceType: 't3.micro' },
      discoveredAt: new Date().toISOString(),
    });

    const costRepo = new MockEc2CostRepository();
    costRepo.seedRecommendation(openRec({ resourceId: 'i-ghost' }));

    const orchestrator = new Ec2CostAnalysisOrchestrator(resources, costRepo, costRepo);
    const result = await orchestrator.run({
      tenantId: TENANT,
      accountId: ACCOUNT,
      regions: ['us-east-1', 'us-west-2'],
      observationDays: 14,
      runId: 'run-partial',
      requestedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      metricsClientFactory: (region) => ({
        collectMetrics: async () => {
          if (region === 'us-west-2') {
            throw Object.assign(new Error('denied'), { name: 'AccessDenied' });
          }
          return [
            {
              tenantId: TENANT,
              accountId: ACCOUNT,
              region,
              instanceId: 'i-run',
              observationStart: '2026-01-01T00:00:00.000Z',
              observationEnd: '2026-01-15T00:00:00.000Z',
              periodSeconds: 3600,
              expectedSampleCount: 100,
              actualSampleCount: 100,
              cpuAveragePercent: 2,
              cpuMaximumPercent: 10,
              dataCompleteness: 'COMPLETE',
              collectedAt: new Date().toISOString(),
              warnings: [],
            },
          ];
        },
      }),
    });

    assert.equal(result.status, 'PARTIAL');
    assert.equal(result.recommendationsResolved, 0);
    const stillOpen = await costRepo.getRecommendation(TENANT, ACCOUNT, 'rec-1');
    assert.equal(stillOpen?.lifecycleStatus, 'OPEN');
  });

  it('SUCCEEDED with no matching finding resolves OPEN and sets resolvedAt', async () => {
    const resources = new MockEc2CloudResourceRepository();
    const costRepo = new MockEc2CostRepository();
    costRepo.seedRecommendation(openRec({ resourceId: 'i-gone' }));

    const orchestrator = new Ec2CostAnalysisOrchestrator(resources, costRepo, costRepo);
    const result = await orchestrator.run({
      tenantId: TENANT,
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-resolve',
      requestedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    });

    assert.equal(result.status, 'SUCCEEDED');
    assert.equal(result.recommendationsResolved, 1);
    const resolved = await costRepo.getRecommendation(TENANT, ACCOUNT, 'rec-1');
    assert.equal(resolved?.lifecycleStatus, 'RESOLVED');
    assert.ok(resolved?.resolvedAt);
  });

  it('preserves firstDetectedAt on recurrence', async () => {
    const resources = new MockEc2CloudResourceRepository();
    await resources.upsertDiscoveredResource({
      tenantId: TENANT,
      accountId: ACCOUNT,
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-stopped',
      tags: [],
      status: 'ACTIVE',
      metadata: { state: 'stopped' },
      discoveredAt: new Date().toISOString(),
    });
    await resources.upsertDiscoveredResource({
      tenantId: TENANT,
      accountId: ACCOUNT,
      region: 'us-east-1',
      resourceType: 'VOLUME',
      resourceId: 'vol-1',
      tags: [],
      status: 'ACTIVE',
      metadata: {
        sizeGiB: 10,
        volumeType: 'gp3',
        attachments: [{ instanceId: 'i-stopped', state: 'attached' }],
      },
      discoveredAt: new Date().toISOString(),
    });

    const costRepo = new MockEc2CostRepository();
    const orchestrator = new Ec2CostAnalysisOrchestrator(resources, costRepo, costRepo);
    await orchestrator.run({
      tenantId: TENANT,
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-a',
      requestedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      metricsClientFactory: () => ({ collectMetrics: async () => [] }),
    });
    const first = [...(await costRepo.listRecommendations({ tenantId: TENANT, accountId: ACCOUNT, limit: 10 })).items][0];
    assert.ok(first);
    const firstDetectedAt = first.firstDetectedAt;
    await orchestrator.run({
      tenantId: TENANT,
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-b',
      requestedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      metricsClientFactory: () => ({ collectMetrics: async () => [] }),
    });
    const second = (await costRepo.listRecommendations({ tenantId: TENANT, accountId: ACCOUNT, limit: 10 })).items.find(
      (r) => r.findingKey === first.findingKey,
    );
    assert.equal(second?.firstDetectedAt, firstDetectedAt);
    assert.notEqual(second?.lastDetectedAt, firstDetectedAt);
  });
});
