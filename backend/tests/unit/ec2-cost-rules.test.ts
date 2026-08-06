import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  stoppedWithStorageRule,
  idleInstanceRule,
  longRunningIdleRule,
  reviewDownsizeRule,
  reviewUpsizeRule,
  burstableCreditRule,
  instanceFamilyUpgradeRule,
} from '../../cloud-intelligence/ec2-cost/ec2-cost-rules';
import type { Ec2CostRuleInput } from '../../cloud-intelligence/ec2-cost/ec2-cost-models';
import type { DiscoveredCloudResourceRecord } from '../../repositories/models/cloud-resource-persistence-models';

function instance(partial: Partial<DiscoveredCloudResourceRecord>): DiscoveredCloudResourceRecord {
  return {
    tenantId: 't1',
    accountId: '111122223333',
    region: 'us-east-1',
    service: 'ec2',
    resourceType: 'INSTANCE',
    resourceId: 'i-test',
    tags: [],
    status: 'ACTIVE',
    metadata: {},
    discoveredAt: '2026-01-01T00:00:00.000Z',
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

function baseInput(overrides: Partial<Ec2CostRuleInput>): Ec2CostRuleInput {
  return {
    tenantId: 't1',
    accountId: '111122223333',
    region: 'us-east-1',
    instance: instance({ resourceId: 'i-test' }),
    volumes: [],
    analysisRunId: 'run-1',
    observationDays: 14,
    ...overrides,
  };
}

describe('EC2 cost rules', () => {
  it('stopped with attached volume triggers stopped storage recommendation', () => {
    const results = stoppedWithStorageRule.evaluate(
      baseInput({
        instance: instance({
          metadata: { state: 'stopped' },
        }),
        volumes: [
          {
            ...instance({
              resourceType: 'VOLUME',
              resourceId: 'vol-1',
              metadata: { sizeGiB: 100, volumeType: 'gp3', attachedInstanceId: 'i-test' },
            }),
            resourceType: 'VOLUME' as const,
          },
        ],
      }),
    );
    assert.equal(results.length, 1);
    assert.equal(results[0]?.category, 'STOPPED_WITH_STORAGE');
    assert.match(results[0]?.recommendedAction ?? '', /approval/i);
  });

  it('idle rule returns insufficient-data outcome when metrics missing', () => {
    const results = idleInstanceRule.evaluate(
      baseInput({
        instance: instance({ metadata: { state: 'running' } }),
      }),
    );
    assert.equal(results.length, 1);
    assert.equal(results[0]?.category, 'INSUFFICIENT_DATA');
  });

  it('idle rule triggers on low CPU with sufficient samples', () => {
    const results = idleInstanceRule.evaluate(
      baseInput({
        instance: instance({ metadata: { state: 'running', instanceType: 't3.micro' } }),
        evidence: {
          tenantId: 't1',
          accountId: '111122223333',
          region: 'us-east-1',
          instanceId: 'i-test',
          observationStart: '2026-01-01T00:00:00.000Z',
          observationEnd: '2026-01-15T00:00:00.000Z',
          periodSeconds: 3600,
          expectedSampleCount: 336,
          actualSampleCount: 320,
          cpuAveragePercent: 2,
          cpuMaximumPercent: 10,
          cpuP95Percent: 8,
          networkInAverageBytes: 1000,
          networkOutAverageBytes: 1000,
          dataCompleteness: 'COMPLETE',
          collectedAt: '2026-01-15T00:00:00.000Z',
          warnings: [],
        },
      }),
    );
    assert.ok(results.length > 0);
  });

  it('long-running idle requires launchTime and age threshold', () => {
    const oldLaunch = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const results = longRunningIdleRule.evaluate(
      baseInput({
        instance: instance({
          metadata: { state: 'running', launchTime: oldLaunch, instanceType: 't3.micro' },
        }),
        evidence: {
          tenantId: 't1',
          accountId: '111122223333',
          region: 'us-east-1',
          instanceId: 'i-test',
          observationStart: '2026-01-01T00:00:00.000Z',
          observationEnd: '2026-01-15T00:00:00.000Z',
          periodSeconds: 3600,
          expectedSampleCount: 336,
          actualSampleCount: 320,
          cpuAveragePercent: 2,
          cpuMaximumPercent: 10,
          dataCompleteness: 'COMPLETE',
          collectedAt: '2026-01-15T00:00:00.000Z',
          warnings: [],
        },
      }),
    );
    assert.equal(results[0]?.category, 'LONG_RUNNING_IDLE');
  });

  it('family upgrade suggests review migration for supported t2 types', () => {
    const results = instanceFamilyUpgradeRule.evaluate(
      baseInput({
        instance: instance({
          metadata: { state: 'running', instanceType: 't2.micro' },
        }),
      }),
    );
    assert.equal(results[0]?.category, 'INSTANCE_FAMILY_UPGRADE');
    assert.match(results[0]?.recommendedAction ?? '', /review/i);
  });

  it('review upsize requires sustained high p95 not isolated spike', () => {
    const low = reviewUpsizeRule.evaluate(
      baseInput({
        instance: instance({ metadata: { state: 'running', instanceType: 'm5.large' } }),
        evidence: {
          tenantId: 't1',
          accountId: '111122223333',
          region: 'us-east-1',
          instanceId: 'i-test',
          observationStart: '2026-01-01T00:00:00.000Z',
          observationEnd: '2026-01-15T00:00:00.000Z',
          periodSeconds: 3600,
          expectedSampleCount: 336,
          actualSampleCount: 320,
          cpuAveragePercent: 20,
          cpuMaximumPercent: 85,
          cpuP95Percent: 55,
          dataCompleteness: 'COMPLETE',
          collectedAt: '2026-01-15T00:00:00.000Z',
          warnings: [],
        },
      }),
    );
    assert.equal(low.length, 0);

    const high = reviewUpsizeRule.evaluate(
      baseInput({
        instance: instance({ metadata: { state: 'running', instanceType: 'm5.large' } }),
        evidence: {
          tenantId: 't1',
          accountId: '111122223333',
          region: 'us-east-1',
          instanceId: 'i-test',
          observationStart: '2026-01-01T00:00:00.000Z',
          observationEnd: '2026-01-15T00:00:00.000Z',
          periodSeconds: 3600,
          expectedSampleCount: 336,
          actualSampleCount: 320,
          cpuAveragePercent: 75,
          cpuMaximumPercent: 95,
          cpuP95Percent: 92,
          dataCompleteness: 'COMPLETE',
          collectedAt: '2026-01-15T00:00:00.000Z',
          warnings: [],
        },
      }),
    );
    assert.equal(high[0]?.category, 'REVIEW_UPSIZE');
  });

  it('burstable credit pressure detects low credit balance', () => {
    const results = burstableCreditRule.evaluate(
      baseInput({
        instance: instance({ metadata: { state: 'running', instanceType: 't3.micro' } }),
        evidence: {
          tenantId: 't1',
          accountId: '111122223333',
          region: 'us-east-1',
          instanceId: 'i-test',
          observationStart: '2026-01-01T00:00:00.000Z',
          observationEnd: '2026-01-15T00:00:00.000Z',
          periodSeconds: 3600,
          expectedSampleCount: 336,
          actualSampleCount: 320,
          cpuCreditBalanceMinimum: 2,
          dataCompleteness: 'COMPLETE',
          collectedAt: '2026-01-15T00:00:00.000Z',
          warnings: [],
        },
      }),
    );
    assert.equal(results[0]?.category, 'BURSTABLE_CREDIT_PRESSURE');
  });

  it('review downsize triggers on conservative low utilization', () => {
    const results = reviewDownsizeRule.evaluate(
      baseInput({
        instance: instance({ metadata: { state: 'running', instanceType: 'm5.4xlarge' } }),
        evidence: {
          tenantId: 't1',
          accountId: '111122223333',
          region: 'us-east-1',
          instanceId: 'i-test',
          observationStart: '2026-01-01T00:00:00.000Z',
          observationEnd: '2026-01-15T00:00:00.000Z',
          periodSeconds: 3600,
          expectedSampleCount: 336,
          actualSampleCount: 320,
          cpuAveragePercent: 3,
          cpuMaximumPercent: 12,
          cpuP95Percent: 10,
          dataCompleteness: 'COMPLETE',
          collectedAt: '2026-01-15T00:00:00.000Z',
          warnings: [],
        },
      }),
    );
    assert.equal(results[0]?.category, 'REVIEW_DOWNSIZE');
  });
});
