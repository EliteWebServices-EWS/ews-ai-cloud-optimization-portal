import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  idleInstanceRule,
  instanceFamilyUpgradeRule,
  reviewUpsizeRule,
  burstableCreditRule,
} from '../../cloud-intelligence/ec2-cost/ec2-cost-rules';

import type { Ec2CostRuleInput } from '../../cloud-intelligence/ec2-cost/ec2-cost-models';
import type { DiscoveredCloudResourceRecord } from '../../repositories/models/cloud-resource-persistence-models';

const instanceRecord: DiscoveredCloudResourceRecord = {
  tenantId: 't',
  accountId: 'a',
  region: 'us-east-1',
  service: 'ec2',
  resourceType: 'INSTANCE',
  resourceId: 'i-1',
  tags: [],
  status: 'ACTIVE',
  metadata: { state: 'running', instanceType: 't3.micro' },
  discoveredAt: '2026-01-01T00:00:00.000Z',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function baseInput(overrides: Partial<Ec2CostRuleInput> = {}): Ec2CostRuleInput {
  return {
    tenantId: 't',
    accountId: 'a',
    region: 'us-east-1',
    instance: instanceRecord,
    volumes: [],
    analysisRunId: 'run',
    observationDays: 14,
    ...overrides,
  };
}

const completeEvidence = {
  tenantId: 't',
  accountId: 'a',
  region: 'us-east-1',
  instanceId: 'i-1',
  observationStart: '2026-01-01T00:00:00.000Z',
  observationEnd: '2026-01-15T00:00:00.000Z',
  periodSeconds: 3600,
  expectedSampleCount: 336,
  actualSampleCount: 320,
  dataCompleteness: 'COMPLETE' as const,
  collectedAt: '2026-01-15T00:00:00.000Z',
  warnings: [],
};

describe('EC2 cost rules hardening', () => {
  it('NO_DATA never generates idle recommendation (only insufficient-data outcome)', () => {
    const results = idleInstanceRule.evaluate(
      baseInput({
        evidence: { ...completeEvidence, dataCompleteness: 'NO_DATA', actualSampleCount: 0 },
      }),
    );
    assert.equal(results[0]?.category, 'INSUFFICIENT_DATA');
    assert.ok(!results.some((r) => r.category === 'IDLE_HIGH_CONFIDENCE'));
  });

  it('low average with high spike avoids high-confidence idle', () => {
    const results = idleInstanceRule.evaluate(
      baseInput({
        evidence: {
          ...completeEvidence,
          cpuAveragePercent: 3,
          cpuMaximumPercent: 85,
          networkInAverageBytes: 5_000_000,
          networkOutAverageBytes: 5_000_000,
        },
      }),
    );
    const high = results.find((r) => r.category === 'IDLE_HIGH_CONFIDENCE');
    assert.equal(high, undefined);
  });

  it('low CPU and low network can yield high-confidence idle', () => {
    const results = idleInstanceRule.evaluate(
      baseInput({
        evidence: {
          ...completeEvidence,
          cpuAveragePercent: 2,
          cpuMaximumPercent: 10,
          networkInAverageBytes: 1000,
          networkOutAverageBytes: 1000,
        },
      }),
    );
    assert.ok(results.some((r) => r.category === 'IDLE_HIGH_CONFIDENCE'));
  });

  it('instance family upgrade does not propose graviton/x86 cross-arch', () => {
    const results = instanceFamilyUpgradeRule.evaluate(
      baseInput({
        instance: { ...instanceRecord, metadata: { state: 'running', instanceType: 'm5.large' } },
      }),
    );
    assert.equal(results.length, 0);
  });

  it('unsupported family returns no recommendation', () => {
    const results = instanceFamilyUpgradeRule.evaluate(
      baseInput({
        instance: { ...instanceRecord, metadata: { state: 'running', instanceType: 'inf1.xlarge' } },
      }),
    );
    assert.equal(results.length, 0);
  });

  it('missing burst credit evidence does not fabricate pressure', () => {
    const results = burstableCreditRule.evaluate(
      baseInput({
        instance: { ...instanceRecord, metadata: { state: 'running', instanceType: 't3.micro' } },
        evidence: { ...completeEvidence, cpuCreditBalanceMinimum: undefined },
      }),
    );
    assert.equal(results.length, 0);
  });

  it('review upsize copy does not claim memory fit', () => {
    const results = reviewUpsizeRule.evaluate(
      baseInput({
        instance: { ...instanceRecord, metadata: { state: 'running', instanceType: 'm5.large' } },
        evidence: {
          ...completeEvidence,
          cpuAveragePercent: 90,
          cpuMaximumPercent: 95,
          cpuP95Percent: 92,
        },
      }),
    );
    assert.match(results[0]?.businessJustification ?? '', /CPU pressure alone/i);
  });
});
