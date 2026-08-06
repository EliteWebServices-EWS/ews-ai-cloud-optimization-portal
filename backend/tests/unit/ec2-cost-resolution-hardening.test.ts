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

const INITIAL_DETECTED = '2026-08-01T10:00:00.000Z';
const RECURRENCE_DETECTED = '2026-08-02T10:00:00.000Z';

function recommendationClockFromSequence(sequence: readonly string[]): () => Date {
  let index = 0;
  return () => {
    const iso = sequence[Math.min(index, sequence.length - 1)] ?? sequence[sequence.length - 1];
    index += 1;
    return new Date(iso);
  };
}

async function seedStoppedInstanceWithVolume(resources: MockEc2CloudResourceRepository): Promise<void> {
  await resources.upsertDiscoveredResource({
    tenantId: TENANT,
    accountId: ACCOUNT,
    region: 'us-east-1',
    resourceType: 'INSTANCE',
    resourceId: 'i-stopped',
    tags: [],
    status: 'ACTIVE',
    metadata: { state: 'stopped' },
    discoveredAt: INITIAL_DETECTED,
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
    discoveredAt: INITIAL_DETECTED,
  });
}

function noopMetricsFactory() {
  return () => ({ collectMetrics: async () => [] });
}

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
    await seedStoppedInstanceWithVolume(resources);

    const costRepo = new MockEc2CostRepository({
      recommendationNow: recommendationClockFromSequence([INITIAL_DETECTED, RECURRENCE_DETECTED]),
    });
    const orchestrator = new Ec2CostAnalysisOrchestrator(resources, costRepo, costRepo);
    await orchestrator.run({
      tenantId: TENANT,
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-a',
      requestedAt: INITIAL_DETECTED,
      startedAt: INITIAL_DETECTED,
      metricsClientFactory: noopMetricsFactory(),
    });
    const first = [...(await costRepo.listRecommendations({ tenantId: TENANT, accountId: ACCOUNT, limit: 10 })).items][0];
    assert.ok(first);
    assert.equal(first.firstDetectedAt, INITIAL_DETECTED);
    assert.equal(first.lastDetectedAt, INITIAL_DETECTED);
    assert.equal(first.version, 1);

    await orchestrator.run({
      tenantId: TENANT,
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-b',
      requestedAt: RECURRENCE_DETECTED,
      startedAt: RECURRENCE_DETECTED,
      metricsClientFactory: noopMetricsFactory(),
    });
    const second = (await costRepo.listRecommendations({ tenantId: TENANT, accountId: ACCOUNT, limit: 10 })).items.find(
      (r) => r.findingKey === first.findingKey,
    );
    assert.equal(second?.firstDetectedAt, INITIAL_DETECTED);
    assert.equal(second?.lastDetectedAt, RECURRENCE_DETECTED);
    assert.ok((second?.version ?? 0) > first.version);
  });
});

describe('EC2 cost recommendation timestamp semantics', () => {
  it('same-millisecond recurrence keeps valid record and increments version', async () => {
    const resources = new MockEc2CloudResourceRepository();
    await seedStoppedInstanceWithVolume(resources);
    const costRepo = new MockEc2CostRepository({
      recommendationNow: () => new Date(INITIAL_DETECTED),
    });
    const orchestrator = new Ec2CostAnalysisOrchestrator(resources, costRepo, costRepo);
    await orchestrator.run({
      tenantId: TENANT,
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-same-a',
      requestedAt: INITIAL_DETECTED,
      startedAt: INITIAL_DETECTED,
      metricsClientFactory: noopMetricsFactory(),
    });
    const first = [...(await costRepo.listRecommendations({ tenantId: TENANT, accountId: ACCOUNT, limit: 10 })).items][0];
    assert.ok(first);

    await orchestrator.run({
      tenantId: TENANT,
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-same-b',
      requestedAt: INITIAL_DETECTED,
      startedAt: INITIAL_DETECTED,
      metricsClientFactory: noopMetricsFactory(),
    });
    const second = (await costRepo.listRecommendations({ tenantId: TENANT, accountId: ACCOUNT, limit: 10 })).items.find(
      (r) => r.findingKey === first.findingKey,
    );
    assert.equal(second?.firstDetectedAt, INITIAL_DETECTED);
    assert.equal(second?.lastDetectedAt, INITIAL_DETECTED);
    assert.equal(second?.version, 2);
  });

  it('RESOLVED recurrence reopens and clears resolvedAt with controlled timestamps', async () => {
    const resources = new MockEc2CloudResourceRepository();
    await seedStoppedInstanceWithVolume(resources);
    const findingKey = buildEc2CostFindingKey({
      tenantId: TENANT,
      accountId: ACCOUNT,
      region: 'us-east-1',
      resourceId: 'i-stopped',
      category: 'STOPPED_WITH_STORAGE',
      ruleVersion: stoppedWithStorageRule.ruleVersion,
    });
    const costRepo = new MockEc2CostRepository({
      recommendationNow: () => new Date(RECURRENCE_DETECTED),
    });
    costRepo.seedRecommendation(
      openRec({
        findingKey,
        resourceId: 'i-stopped',
        lifecycleStatus: 'RESOLVED',
        resolvedAt: '2026-07-01T00:00:00.000Z',
        firstDetectedAt: INITIAL_DETECTED,
        lastDetectedAt: INITIAL_DETECTED,
      }),
    );

    const orchestrator = new Ec2CostAnalysisOrchestrator(resources, costRepo, costRepo);
    await orchestrator.run({
      tenantId: TENANT,
      accountId: ACCOUNT,
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-reopen',
      requestedAt: RECURRENCE_DETECTED,
      startedAt: RECURRENCE_DETECTED,
      metricsClientFactory: noopMetricsFactory(),
    });

    const updated = (await costRepo.listRecommendations({ tenantId: TENANT, accountId: ACCOUNT, limit: 10 })).items.find(
      (r) => r.findingKey === findingKey,
    );
    assert.equal(updated?.lifecycleStatus, 'OPEN');
    assert.equal(updated?.firstDetectedAt, INITIAL_DETECTED);
    assert.equal(updated?.lastDetectedAt, RECURRENCE_DETECTED);
    assert.equal(updated?.resolvedAt, undefined);
    assert.equal(updated?.version, 2);
  });

  it('ACKNOWLEDGED and DISMISSED lifecycles stay preserved on recurrence upsert', async () => {
    for (const lifecycleStatus of ['ACKNOWLEDGED', 'DISMISSED'] as const) {
      const costRepo = new MockEc2CostRepository({
        recommendationNow: () => new Date(RECURRENCE_DETECTED),
      });
      const existing = openRec({
        lifecycleStatus,
        firstDetectedAt: INITIAL_DETECTED,
        lastDetectedAt: INITIAL_DETECTED,
        version: 1,
      });
      costRepo.seedRecommendation(existing);
      const updated = await costRepo.upsertRecommendation({
        findingKey: existing.findingKey,
        recommendation: {
          ...existing,
          lifecycleStatus: 'OPEN',
          analysisRunId: 'run-recur',
        },
      });
      assert.equal(updated.lifecycleStatus, lifecycleStatus);
      assert.equal(updated.firstDetectedAt, INITIAL_DETECTED);
      assert.equal(updated.lastDetectedAt, RECURRENCE_DETECTED);
      assert.equal(updated.version, 2);
    }
  });

  it('matches DynamoDB upsert contract: firstDetectedAt preserved, lastDetectedAt from detection instant', () => {
    const contract = {
      onCreate: (instant: string) => ({
        firstDetectedAt: instant,
        lastDetectedAt: instant,
      }),
      onRecurrence: (first: string, recurrence: string) => ({
        firstDetectedAt: first,
        lastDetectedAt: recurrence,
      }),
    };
    const created = contract.onCreate(INITIAL_DETECTED);
    const recurring = contract.onRecurrence(INITIAL_DETECTED, RECURRENCE_DETECTED);
    assert.deepEqual(created, { firstDetectedAt: INITIAL_DETECTED, lastDetectedAt: INITIAL_DETECTED });
    assert.deepEqual(recurring, {
      firstDetectedAt: INITIAL_DETECTED,
      lastDetectedAt: RECURRENCE_DETECTED,
    });
  });
});
