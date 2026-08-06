import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildEc2SecurityFindingKey, EC2_SECURITY_RULE_VERSION } from '../../database';
import { Ec2SecurityAnalysisOrchestrator } from '../../cloud-intelligence/ec2-security/ec2-security-analysis-orchestrator';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2SecurityRepository } from '../../repositories/mock/mock-ec2-security-repository';

describe('ec2-security finding lifecycle', () => {
  it('preserves firstDetectedAt and increments version on repeat findings', async () => {
    const resources = new MockEc2CloudResourceRepository();
    const security = new MockEc2SecurityRepository();
    await resources.upsertDiscoveredResource({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'INSTANCE',
      resourceId: 'i-1',
      tags: [{ key: 'Name', value: 'app-node' }],
      status: 'ACTIVE',
      metadata: {
        instanceType: 't3.micro',
        publicIpAddress: '203.0.113.10',
        metadataOptions: { httpTokens: 'required' },
        monitoringState: 'enabled',
        securityGroups: [
          {
            groupId: 'sg-1',
            inboundRules: [{ protocol: 'tcp', fromPort: 443, toPort: 443, ipv4Ranges: ['10.0.0.0/8'] }],
          },
        ],
      },
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });
    await resources.upsertDiscoveredResource({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceType: 'VOLUME',
      resourceId: 'vol-1',
      tags: [],
      status: 'ACTIVE',
      metadata: {
        encrypted: true,
        attachments: [{ instanceId: 'i-1', state: 'attached' }],
      },
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });

    const orchestrator = new Ec2SecurityAnalysisOrchestrator(resources, security, security, security);
    await orchestrator.runAnalysis({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      regions: ['us-east-1'],
    });
    const key = buildEc2SecurityFindingKey({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceId: 'i-1',
      check: 'public_ip_exposure',
      ruleVersion: EC2_SECURITY_RULE_VERSION,
    });
    const first = await security.getFindingByKey('tenant-a', '111122223333', key);
    assert.ok(first);
    const firstDetectedAt = first.firstDetectedAt;
    await orchestrator.runAnalysis({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      regions: ['us-east-1'],
    });
    const second = await security.getFindingByKey('tenant-a', '111122223333', key);
    assert.ok(second);
    assert.equal(second.firstDetectedAt, firstDetectedAt);
    assert.equal(second.version, first!.version + 1);
  });

  it('resolves absent OPEN findings only for SUCCEEDED scope', async () => {
    const resources = new MockEc2CloudResourceRepository();
    const security = new MockEc2SecurityRepository();
    const staleKey = buildEc2SecurityFindingKey({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceId: 'i-stale',
      check: 'public_ip_exposure',
      ruleVersion: EC2_SECURITY_RULE_VERSION,
    });
    security.seedFinding({
      findingId: 'stale-1',
      findingKey: staleKey,
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceId: 'i-stale',
      resourceType: 'INSTANCE',
      category: 'security',
      check: 'public_ip_exposure',
      ruleVersion: EC2_SECURITY_RULE_VERSION,
      severity: 'medium',
      status: 'OPEN',
      message: 'old',
      recommendation: 'fix',
      analysisRunId: 'run-old',
      firstDetectedAt: '2026-01-01T00:00:00.000Z',
      lastDetectedAt: '2026-01-01T00:00:00.000Z',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const orchestrator = new Ec2SecurityAnalysisOrchestrator(resources, security, security, security);
    await orchestrator.runAnalysis({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      regions: ['us-east-1'],
      completionStatus: 'SUCCEEDED',
    });
    const resolved = await security.getFindingByKey('tenant-a', '111122223333', staleKey);
    assert.equal(resolved?.status, 'RESOLVED');

    security.seedFinding({
      findingId: 'stale-2',
      findingKey: staleKey,
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceId: 'i-stale',
      resourceType: 'INSTANCE',
      category: 'security',
      check: 'public_ip_exposure',
      ruleVersion: EC2_SECURITY_RULE_VERSION,
      severity: 'medium',
      status: 'OPEN',
      message: 'old',
      recommendation: 'fix',
      analysisRunId: 'run-old',
      firstDetectedAt: '2026-01-01T00:00:00.000Z',
      lastDetectedAt: '2026-01-01T00:00:00.000Z',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await orchestrator.runAnalysis({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      regions: ['us-east-1'],
      completionStatus: 'PARTIAL',
    });
    const untouched = await security.getFindingByKey('tenant-a', '111122223333', staleKey);
    assert.equal(untouched?.status, 'OPEN');
  });
});
