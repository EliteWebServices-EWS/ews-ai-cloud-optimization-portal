import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Ec2CostAnalysisOrchestrator } from '../../cloud-intelligence/ec2-cost/ec2-cost-analysis-orchestrator';
import type { Ec2PerformanceEvidence } from '../../cloud-intelligence/ec2-cost/ec2-cost-models';
import { buildEc2CostFindingKey } from '../../database/cloud-resources/ec2-cost-keys';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import { EvidencePersistenceService } from '../../services/evidence-persistence-service';
import { seedStoppedInstanceWithVolume } from '../fixtures/evidence';

describe('Sprint 1 EC2 provenance and observation timestamp regression', () => {
  it('persists evidence observationTimestamp from metrics observationEnd and async jobId', async () => {
    const resources = new MockEc2CloudResourceRepository();
    await seedStoppedInstanceWithVolume(resources, undefined, '2026-08-10T08:00:00.000Z');

    const costRepo = new MockEc2CostRepository();
    const observations = new MockEvidenceObservationRepository();
    const persistence = new EvidencePersistenceService(observations);
    const orchestrator = new Ec2CostAnalysisOrchestrator(
      resources,
      costRepo,
      costRepo,
      persistence,
    );

    const metricsObservationEnd = '2026-08-10T11:30:00.000Z';
    const metricsFactory = () => ({
      collectMetrics: async () =>
        [
          {
            tenantId: 'tenant-a',
            accountId: '111122223333',
            region: 'us-east-1',
            instanceId: 'i-stopped',
            observationStart: '2026-07-27T11:30:00.000Z',
            observationEnd: metricsObservationEnd,
            periodSeconds: 3600,
            expectedSampleCount: 336,
            actualSampleCount: 336,
            dataCompleteness: 'COMPLETE',
            collectedAt: '2026-08-10T11:31:00.000Z',
            warnings: [],
          } satisfies Ec2PerformanceEvidence,
        ],
    });

    await orchestrator.run({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-metrics',
      requestedAt: '2026-08-10T11:31:00.000Z',
      startedAt: '2026-08-10T11:31:00.000Z',
      metricsClientFactory: metricsFactory,
      correlationId: 'corr-async-1',
      jobId: 'job-async-1',
    });

    const findingKey = buildEc2CostFindingKey({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceId: 'i-stopped',
      category: 'STOPPED_WITH_STORAGE',
      ruleVersion: '1.0.0',
    });

    const history = await observations.listObservationsForFinding({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      findingKey,
    });

    assert.equal(history.items.length, 1);
    assert.equal(history.items[0]!.observationTimestamp, metricsObservationEnd);
    assert.notEqual(history.items[0]!.observationTimestamp, history.items[0]!.collectionTimestamp);
    assert.equal(history.items[0]!.jobId, 'job-async-1');
    assert.equal(history.items[0]!.correlationId, 'corr-async-1');
  });
});
