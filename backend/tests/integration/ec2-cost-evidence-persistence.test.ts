import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Ec2CostAnalysisOrchestrator } from '../../cloud-intelligence/ec2-cost/ec2-cost-analysis-orchestrator';
import { buildEc2CostFindingKey } from '../../database/cloud-resources/ec2-cost-keys';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import { EvidencePersistenceService } from '../../services/evidence-persistence-service';
import {
  ACCOUNT_A,
  buildEmptyMetricsFactory,
  RESOURCE_ID_STOPPED,
  seedStoppedInstanceWithVolume,
  TENANT_A,
} from '../fixtures/evidence';

describe('EC2 cost evidence persistence integration', () => {
  it('persists historical observations through the cost analysis orchestrator', async () => {
    const resources = new MockEc2CloudResourceRepository();
    await seedStoppedInstanceWithVolume(resources, undefined, new Date('2026-08-10T10:00:00.000Z').toISOString());

    const costRepo = new MockEc2CostRepository({
      recommendationNow: () => new Date('2026-08-10T12:00:00.000Z'),
    });
    const observations = new MockEvidenceObservationRepository();
    const persistence = new EvidencePersistenceService(observations);
    const orchestrator = new Ec2CostAnalysisOrchestrator(
      resources,
      costRepo,
      costRepo,
      persistence,
    );

    const metricsFactory = buildEmptyMetricsFactory();

    const first = await orchestrator.run({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-1',
      requestedAt: '2026-08-10T11:00:00.000Z',
      startedAt: '2026-08-10T11:00:00.000Z',
      metricsClientFactory: metricsFactory,
      correlationId: 'corr-1',
    });
    assert.equal(first.recommendationsCreated, 1);

    const findingKey = buildEc2CostFindingKey({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'us-east-1',
      resourceId: RESOURCE_ID_STOPPED,
      category: 'STOPPED_WITH_STORAGE',
      ruleVersion: '1.0.0',
    });
    const firstHistory = await observations.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey,
    });
    assert.equal(firstHistory.items.length, 1);
    assert.equal(firstHistory.items[0]!.assessment.state, 'NEW');
    assert.equal(firstHistory.items[0]!.correlationId, 'corr-1');

    const second = await orchestrator.run({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-2',
      requestedAt: '2026-08-11T11:00:00.000Z',
      startedAt: '2026-08-11T11:00:00.000Z',
      metricsClientFactory: metricsFactory,
      correlationId: 'corr-2',
    });
    assert.equal(second.recommendationsUpdated, 1);

    const secondHistory = await observations.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey,
    });
    assert.equal(secondHistory.items.length, 2);
    assert.equal(secondHistory.items[0]!.assessment.state, 'NEW');
    assert.equal(secondHistory.items[1]!.assessment.state, 'STABLE');
    assert.ok((secondHistory.items[1]!.assessment.persistenceHours ?? 0) >= 0);
  });
});
