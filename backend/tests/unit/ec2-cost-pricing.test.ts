import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  computeSavings,
  defaultPricingAssumptions,
  EC2_ON_DEMAND_CATALOG_VERSION,
  monthlyEbsStorageCost,
  monthlyInstanceCost,
} from '../../cloud-intelligence/ec2-cost/ec2-on-demand-pricing-catalog';
import { EC2_COST_MONTHLY_HOURS } from '../../cloud-intelligence/ec2-cost/ec2-cost-limits';
import { stoppedWithStorageRule } from '../../cloud-intelligence/ec2-cost/ec2-cost-rules';

const catalogPath = join(__dirname, '../../cloud-intelligence/ec2-cost/ec2-on-demand-pricing-catalog.ts');

describe('EC2 cost pricing catalog', () => {
  it('uses documented 730 monthly hours', () => {
    assert.equal(EC2_COST_MONTHLY_HOURS, 730);
    assert.equal(defaultPricingAssumptions('us-east-1').monthlyHours, 730);
  });

  it('calculates monthly instance cost from catalog sample rate', () => {
    const monthly = monthlyInstanceCost('us-east-1', 't3.micro');
    assert.equal(monthly, 7.59);
  });

  it('calculates EBS storage from catalog sample rate', () => {
    const monthly = monthlyEbsStorageCost('us-east-1', 'gp3', 100);
    assert.equal(monthly, 8);
  });

  it('computeSavings never returns negative monthly savings', () => {
    const { monthly, annual } = computeSavings(10, 20);
    assert.equal(monthly, 0);
    assert.equal(annual, 0);
    const positive = computeSavings(20, 10);
    assert.equal(positive.monthly, 10);
    assert.equal(positive.annual, 120);
  });

  it('unsupported price returns undefined', () => {
    assert.equal(monthlyInstanceCost('us-east-1', 'z999.999'), undefined);
  });

  it('stores catalog version and assumptions metadata', () => {
    const assumptions = defaultPricingAssumptions('us-east-1');
    assert.equal(assumptions.catalogVersion, EC2_ON_DEMAND_CATALOG_VERSION);
    assert.equal(assumptions.pricingSource, 'CONTROLLED_CATALOG_SAMPLE');
    assert.equal(assumptions.priceEffectiveDate, '2026-08-01');
    assert.equal(assumptions.currency, 'USD');
    assert.equal(assumptions.pricingModel, 'ON_DEMAND');
  });

  it('unsupported region does not fall back to another region rate', () => {
    assert.equal(monthlyInstanceCost('eu-west-1', 't3.micro'), undefined);
    assert.equal(monthlyInstanceCost('us-east-1', 't3.micro'), 7.59);
  });

  it('catalog-backed rule evaluation uses CONTROLLED_CATALOG_SAMPLE status', () => {
    const results = stoppedWithStorageRule.evaluate({
      tenantId: 't',
      accountId: '111122223333',
      region: 'us-east-1',
      instance: {
        tenantId: 't',
        accountId: '111122223333',
        region: 'us-east-1',
        service: 'ec2',
        resourceType: 'INSTANCE',
        resourceId: 'i-stopped',
        tags: [],
        status: 'ACTIVE',
        metadata: { state: 'stopped' },
        discoveredAt: '2026-01-01T00:00:00.000Z',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      volumes: [
        {
          tenantId: 't',
          accountId: '111122223333',
          region: 'us-east-1',
          service: 'ec2',
          resourceType: 'VOLUME',
          resourceId: 'vol-1',
          tags: [],
          status: 'ACTIVE',
          metadata: {
            sizeGiB: 10,
            volumeType: 'gp3',
            attachments: [{ instanceId: 'i-stopped', state: 'attached' }],
          },
          discoveredAt: '2026-01-01T00:00:00.000Z',
          firstSeenAt: '2026-01-01T00:00:00.000Z',
          lastSeenAt: '2026-01-01T00:00:00.000Z',
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      analysisRunId: 'run',
      observationDays: 14,
    });
    assert.equal(results[0]?.pricingStatus, 'CONTROLLED_CATALOG_SAMPLE');
    assert.notEqual(results[0]?.pricingStatus, 'VERIFIED_RATE');
  });

  it('does not import Cost Explorer client', () => {
    const text = readFileSync(catalogPath, 'utf8');
    assert.doesNotMatch(text, /cost-explorer|GetCostAndUsage|ComputeOptimizer/i);
  });
});
