import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Ec2CostAnalysisOrchestrator } from '../../cloud-intelligence/ec2-cost/ec2-cost-analysis-orchestrator';
import type { Ec2CostRecommendationRecord } from '../../cloud-intelligence/ec2-cost/ec2-cost-models';
import type { Ec2PerformanceEvidence } from '../../cloud-intelligence/ec2-cost/ec2-cost-models';
import { buildEc2CostFindingKey } from '../../database/cloud-resources/ec2-cost-keys';
import { PersistenceDataQualityError } from '../../persistence-intelligence/errors';
import type { UpsertEc2CostRecommendationInput } from '../../repositories/contracts/ec2-cost-repository';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import { EvidencePersistenceService } from '../../services/evidence-persistence-service';
import type {
  RecordEvidenceObservationInput,
  RecordEvidenceObservationResult,
} from '../../persistence-intelligence/types';
import {
  FIXED_OBSERVATION_TS_1,
  FIXED_OBSERVATION_TS_2,
  RESOURCE_ID_STOPPED,
} from '../fixtures/evidence/identities';
import { seedStoppedInstanceWithVolume } from '../fixtures/evidence';

class FailingEvidenceObservationRepository extends MockEvidenceObservationRepository {
  constructor(private readonly message = 'EVIDENCE_WRITE_FAILED') {
    super();
  }

  override async recordObservation(
    _input: RecordEvidenceObservationInput,
  ): Promise<RecordEvidenceObservationResult> {
    throw new PersistenceDataQualityError(this.message);
  }
}

class FailingUpsertEc2CostRepository extends MockEc2CostRepository {
  constructor(private readonly message = 'RECOMMENDATION_WRITE_FAILED') {
    super();
  }

  override async upsertRecommendation(
    _input: UpsertEc2CostRecommendationInput,
  ): Promise<Ec2CostRecommendationRecord> {
    throw new Error(this.message);
  }
}

async function seedStoppedInstanceScenario(resources: MockEc2CloudResourceRepository): Promise<void> {
  await seedStoppedInstanceWithVolume(resources);
}

function buildStoppedInstanceMetricsEvidence(observationEnd: string): Ec2PerformanceEvidence {
  return {
    tenantId: 'tenant-a',
    accountId: '111122223333',
    region: 'us-east-1',
    instanceId: RESOURCE_ID_STOPPED,
    observationStart: '2026-07-27T12:00:00.000Z',
    observationEnd,
    periodSeconds: 3600,
    expectedSampleCount: 336,
    actualSampleCount: 336,
    dataCompleteness: 'COMPLETE',
    collectedAt: '2026-08-10T12:05:00.000Z',
    warnings: [],
  };
}

describe('Sprint 1 persistence consistency', () => {
  it('persists evidence before recommendation and succeeds end-to-end', async () => {
    const resources = new MockEc2CloudResourceRepository();
    await seedStoppedInstanceScenario(resources);
    const costRepo = new MockEc2CostRepository();
    const observations = new MockEvidenceObservationRepository();
    const persistence = new EvidencePersistenceService(observations);
    const orchestrator = new Ec2CostAnalysisOrchestrator(
      resources,
      costRepo,
      costRepo,
      persistence,
    );

    await orchestrator.run({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-success',
      requestedAt: '2026-08-10T11:00:00.000Z',
      startedAt: '2026-08-10T11:00:00.000Z',
      metricsClientFactory: () => ({ collectMetrics: async () => [] }),
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
    const recommendation = await costRepo.getRecommendationByScope({
      tenantId: 'tenant-a',
      accountId: '111122223333',
      region: 'us-east-1',
      category: 'STOPPED_WITH_STORAGE',
      resourceId: 'i-stopped',
      ruleVersion: '1.0.0',
    });

    assert.equal(history.items.length, 1);
    assert.ok(recommendation);
    assert.equal(history.items[0]!.recommendationId, recommendation.recommendationId);
    assert.equal(history.items[0]!.assessment.state, 'NEW');
  });

  it('does not persist recommendation when evidence persistence fails first', async () => {
    const resources = new MockEc2CloudResourceRepository();
    await seedStoppedInstanceScenario(resources);
    const costRepo = new MockEc2CostRepository();
    const observations = new FailingEvidenceObservationRepository();
    const persistence = new EvidencePersistenceService(observations);
    const orchestrator = new Ec2CostAnalysisOrchestrator(
      resources,
      costRepo,
      costRepo,
      persistence,
    );

    await assert.rejects(
      () =>
        orchestrator.run({
          tenantId: 'tenant-a',
          accountId: '111122223333',
          regions: ['us-east-1'],
          observationDays: 14,
          runId: 'run-evidence-fail',
          requestedAt: '2026-08-10T11:00:00.000Z',
          startedAt: '2026-08-10T11:00:00.000Z',
          metricsClientFactory: () => ({ collectMetrics: async () => [] }),
        }),
      PersistenceDataQualityError,
    );

    const recommendations = await costRepo.listRecommendations({
      tenantId: 'tenant-a',
      accountId: '111122223333',
    });
    assert.equal(recommendations.items.length, 0);
  });

  it('leaves evidence persisted when recommendation upsert fails afterward', async () => {
    const resources = new MockEc2CloudResourceRepository();
    await seedStoppedInstanceScenario(resources);
    const costRepo = new FailingUpsertEc2CostRepository();
    const observations = new MockEvidenceObservationRepository();
    const persistence = new EvidencePersistenceService(observations);
    const orchestrator = new Ec2CostAnalysisOrchestrator(
      resources,
      costRepo,
      costRepo,
      persistence,
    );

    await assert.rejects(() =>
      orchestrator.run({
        tenantId: 'tenant-a',
        accountId: '111122223333',
        regions: ['us-east-1'],
        observationDays: 14,
        runId: 'run-rec-fail',
        requestedAt: '2026-08-10T11:00:00.000Z',
        startedAt: '2026-08-10T11:00:00.000Z',
        metricsClientFactory: () => ({ collectMetrics: async () => [] }),
      }),
    );

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
    const recommendations = await costRepo.listRecommendations({
      tenantId: 'tenant-a',
      accountId: '111122223333',
    });

    assert.equal(history.items.length, 1);
    assert.equal(recommendations.items.length, 0);
    assert.equal(history.items[0]!.assessment.state, 'NEW');
  });

  it('retries after evidence failure without duplicate history when no observation was written', async () => {
    const resources = new MockEc2CloudResourceRepository();
    await seedStoppedInstanceScenario(resources);
    const costRepo = new MockEc2CostRepository();
    let failEvidence = true;
    const observations = new (class extends MockEvidenceObservationRepository {
      override async recordObservation(input: RecordEvidenceObservationInput) {
        if (failEvidence) {
          failEvidence = false;
          throw new PersistenceDataQualityError('EVIDENCE_WRITE_FAILED');
        }
        return super.recordObservation(input);
      }
    })();
    const persistence = new EvidencePersistenceService(observations);
    const orchestrator = new Ec2CostAnalysisOrchestrator(
      resources,
      costRepo,
      costRepo,
      persistence,
    );
    const runInput = {
      tenantId: 'tenant-a',
      accountId: '111122223333',
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-retry',
      requestedAt: '2026-08-10T11:00:00.000Z',
      startedAt: '2026-08-10T11:00:00.000Z',
      metricsClientFactory: () => ({ collectMetrics: async () => [] }),
    };

    await assert.rejects(() => orchestrator.run(runInput), PersistenceDataQualityError);
    const firstRecommendations = await costRepo.listRecommendations({
      tenantId: 'tenant-a',
      accountId: '111122223333',
    });
    assert.equal(firstRecommendations.items.length, 0);

    await orchestrator.run(runInput);
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
  });

  it('heals recommendation on retry while allowing a new observation when retry has a different observationTimestamp', async () => {
    const resources = new MockEc2CloudResourceRepository();
    await seedStoppedInstanceScenario(resources);
    let failUpsert = true;
    const costRepo = new (class extends MockEc2CostRepository {
      override async upsertRecommendation(
        ...args: Parameters<MockEc2CostRepository['upsertRecommendation']>
      ) {
        if (failUpsert) {
          failUpsert = false;
          throw new Error('RECOMMENDATION_WRITE_FAILED');
        }
        return super.upsertRecommendation(...args);
      }
    })();
    const observations = new MockEvidenceObservationRepository();
    const persistence = new EvidencePersistenceService(observations);
    const orchestrator = new Ec2CostAnalysisOrchestrator(
      resources,
      costRepo,
      costRepo,
      persistence,
    );
    let orchestratorRunCount = 0;
    const runInput = {
      tenantId: 'tenant-a',
      accountId: '111122223333',
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-rec-retry',
      requestedAt: '2026-08-10T11:00:00.000Z',
      startedAt: '2026-08-10T11:00:00.000Z',
      metricsClientFactory: () => {
        orchestratorRunCount += 1;
        const observationEnd =
          orchestratorRunCount === 1 ? FIXED_OBSERVATION_TS_1 : FIXED_OBSERVATION_TS_2;
        return {
          collectMetrics: async () => [buildStoppedInstanceMetricsEvidence(observationEnd)],
        };
      },
    };

    await assert.rejects(() => orchestrator.run(runInput), /RECOMMENDATION_WRITE_FAILED/);
    await orchestrator.run(runInput);

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
    const recommendations = await costRepo.listRecommendations({
      tenantId: 'tenant-a',
      accountId: '111122223333',
    });
    assert.equal(history.items.length, 2);
    assert.equal(recommendations.items.length, 1);
    assert.notEqual(
      history.items[0]!.observationTimestamp,
      history.items[1]!.observationTimestamp,
    );
    assert.equal(history.items[0]!.assessment.state, 'NEW');
    assert.equal(history.items[1]!.assessment.state, 'STABLE');
  });
});
