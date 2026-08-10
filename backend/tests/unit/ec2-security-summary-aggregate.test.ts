import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAccountSecuritySummaryView,
  buildRegionSecuritySummaryView,
} from '../../cloud-intelligence/ec2-security/ec2-security-summary-aggregate';
import type {
  Ec2SecurityFindingRecord,
  Ec2SecuritySummaryRecord,
} from '../../cloud-intelligence/ec2-security/ec2-security-models';

function summary(partial: Partial<Ec2SecuritySummaryRecord> & Pick<Ec2SecuritySummaryRecord, 'region'>): Ec2SecuritySummaryRecord {
  return {
    tenantId: 'tenant-a',
    accountId: '111122223333',
    securityScore: 80,
    governanceScore: 70,
    complianceScore: 75,
    riskLevel: 'medium',
    instancesAnalyzed: 2,
    openFindingCount: 1,
    analyzedAt: '2026-02-01T00:00:00.000Z',
    analysisRunId: 'run-1',
    version: 1,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    ...partial,
  };
}

function finding(region: string, severity: Ec2SecurityFindingRecord['severity']): Ec2SecurityFindingRecord {
  return {
    findingId: `${region}-${severity}`,
    findingKey: `${region}-${severity}`,
    tenantId: 'tenant-a',
    accountId: '111122223333',
    region,
    resourceId: 'i-1',
    resourceType: 'INSTANCE',
    category: 'security',
    check: 'public_ip_exposure',
    ruleVersion: '1',
    severity,
    status: 'OPEN',
    message: 'msg',
    recommendation: 'rec',
    analysisRunId: 'run-1',
    firstDetectedAt: '2026-02-01T00:00:00.000Z',
    lastDetectedAt: '2026-02-01T00:00:00.000Z',
    version: 1,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  };
}

describe('ec2-security summary aggregate', () => {
  it('aggregates account-wide counts across two regions without double-counting summaries', () => {
    const view = buildAccountSecuritySummaryView(
      [
        summary({ region: 'us-east-1', securityScore: 80, analyzedAt: '2026-02-01T00:00:00.000Z' }),
        summary({ region: 'eu-west-1', securityScore: 60, analyzedAt: '2026-02-02T00:00:00.000Z' }),
      ],
      [finding('us-east-1', 'high'), finding('eu-west-1', 'medium')],
    );
    assert.ok(view);
    assert.equal(view.scope, 'account');
    assert.deepEqual(view.regionsIncluded, ['eu-west-1', 'us-east-1']);
    assert.equal(view.openFindingCount, 2);
    assert.equal(view.instancesAnalyzed, 4);
    assert.equal(view.securityScore, 70);
    assert.equal(view.analyzedAt, '2026-02-02T00:00:00.000Z');
  });

  it('returns region-specific summary for one region', () => {
    const view = buildRegionSecuritySummaryView(
      summary({ region: 'us-east-1' }),
      [finding('us-east-1', 'critical'), finding('eu-west-1', 'low')],
    );
    assert.equal(view.scope, 'region');
    assert.equal(view.region, 'us-east-1');
    assert.equal(view.openFindingCount, 1);
    assert.equal(view.findingsBySeverity.critical, 1);
  });

  it('excludes zero-instance regions from score average when only some regions were analyzed', () => {
    const view = buildAccountSecuritySummaryView(
      [
        summary({ region: 'us-east-1', instancesAnalyzed: 2, securityScore: 80 }),
        summary({ region: 'eu-west-1', instancesAnalyzed: 0, securityScore: 100, analysisRunId: '' }),
      ],
      [],
    );
    assert.ok(view);
    assert.equal(view.scoreAvailability, 'partial');
    assert.equal(view.securityScore, 80);
    assert.ok(view.warnings.length > 0);
  });

  it('returns complete with zero scores when analysis ran with no instances', () => {
    const view = buildAccountSecuritySummaryView(
      [
        summary({
          region: 'us-east-1',
          instancesAnalyzed: 0,
          securityScore: 0,
          governanceScore: 0,
          complianceScore: 0,
          riskLevel: 'low',
        }),
      ],
      [],
    );
    assert.ok(view);
    assert.equal(view.scoreAvailability, 'complete');
    assert.equal(view.securityScore, 0);
    assert.equal(view.governanceScore, 0);
    assert.equal(view.riskLevel, 'low');
    assert.ok(view.warnings.some((w) => w.includes('no EC2 instances')));
  });

  it('returns region complete when analysisRunId exists with zero instances', () => {
    const view = buildRegionSecuritySummaryView(
      summary({ region: 'us-east-1', instancesAnalyzed: 0, securityScore: 0, governanceScore: 0, complianceScore: 0, riskLevel: 'low' }),
      [],
    );
    assert.equal(view.scoreAvailability, 'complete');
    assert.equal(view.securityScore, 0);
    assert.ok(view.warnings.length > 0);
  });

  it('returns unavailable when summary has no analysisRunId and zero instances', () => {
    const view = buildAccountSecuritySummaryView(
      [summary({ region: 'us-east-1', instancesAnalyzed: 0, analysisRunId: '' })],
      [],
    );
    assert.ok(view);
    assert.equal(view.scoreAvailability, 'unavailable');
    assert.equal(view.securityScore, null);
    assert.equal(view.riskLevel, 'unavailable');
  });

  it('returns null for account view when no summaries exist', () => {
    assert.equal(buildAccountSecuritySummaryView([], []), null);
  });
});
