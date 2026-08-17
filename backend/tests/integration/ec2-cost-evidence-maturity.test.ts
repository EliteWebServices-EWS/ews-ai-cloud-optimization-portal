import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Ec2CostAnalysisOrchestrator } from '../../cloud-intelligence/ec2-cost/ec2-cost-analysis-orchestrator';
import { buildEc2CostFindingKey } from '../../database/cloud-resources/ec2-cost-keys';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import { MockEvidenceMaturityRepository } from '../../repositories/mock/mock-evidence-maturity-repository';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import { EvidenceMaturityService } from '../../services/evidence-maturity-service';
import { EvidencePersistenceService } from '../../services/evidence-persistence-service';
import {
  ACCOUNT_A,
  RESOURCE_ID_STOPPED,
  TENANT_A,
  buildEmptyMetricsFactory,
  buildRecordEvidenceObservationInput,
  seedStoppedInstanceWithVolume,
} from '../fixtures/evidence';
import {
  FIXED_OBSERVATION_TS_1,
  FIXED_OBSERVATION_TS_2,
  FIXED_OBSERVATION_TS_3,
} from '../fixtures/evidence/identities';

describe('EC2 cost evidence maturity integration', () => {
  it('creates evidence observation, persistence assessment, and maturity assessment', async () => {
    const resources = new MockEc2CloudResourceRepository();
    await seedStoppedInstanceWithVolume(resources, undefined, '2026-08-10T10:00:00.000Z');

    const costRepo = new MockEc2CostRepository({
      recommendationNow: () => new Date('2026-08-10T12:00:00.000Z'),
    });
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const persistence = new EvidencePersistenceService(observations);
    const maturity = new EvidenceMaturityService(maturityRepo, observations);
    const orchestrator = new Ec2CostAnalysisOrchestrator(
      resources,
      costRepo,
      costRepo,
      persistence,
      maturity,
    );

    await orchestrator.run({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-maturity-1',
      requestedAt: '2026-08-10T11:00:00.000Z',
      startedAt: '2026-08-10T11:00:00.000Z',
      metricsClientFactory: buildEmptyMetricsFactory(),
    });

    const findingKey = buildEc2CostFindingKey({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'us-east-1',
      resourceId: RESOURCE_ID_STOPPED,
      category: 'STOPPED_WITH_STORAGE',
      ruleVersion: '1.0.0',
    });
    const history = await observations.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey,
    });
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0]!.assessment.state, 'NEW');

    const maturityList = await maturityRepo.listAssessmentsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey,
    });
    assert.equal(maturityList.items.length, 1);
    assert.equal(maturityList.items[0]!.maturity, 'IMMATURE');
  });

  it('reaches PARTIAL then MATURE after repeated stable evidence', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const persistence = new EvidencePersistenceService(observations);
    const maturity = new EvidenceMaturityService(maturityRepo, observations);

    const stoppedBase = {
      category: 'STOPPED_WITH_STORAGE' as const,
      ruleId: 'ec2.cost.stopped_with_storage',
    };
    const runTimestamps = [FIXED_OBSERVATION_TS_1, FIXED_OBSERVATION_TS_2, FIXED_OBSERVATION_TS_3];
    const maturityResults: string[] = [];

    for (const [index, observationTimestamp] of runTimestamps.entries()) {
      const recorded = await persistence.recordObservation(
        buildRecordEvidenceObservationInput({
          ...stoppedBase,
          analysisRunId: `run-maturity-stable-${index + 1}`,
          observationTimestamp,
          collectionTimestamp: observationTimestamp,
          recommendationVersion: index + 1,
        }),
      );
      const result = await maturity.evaluateAndPersist({
        observation: recorded.observation,
        evaluatedAt: observationTimestamp,
      });
      maturityResults.push(result.record.maturity);
    }

    assert.deepEqual(maturityResults, ['IMMATURE', 'PARTIAL', 'MATURE']);
  });

  it('preserves evidence observation when maturity repository fails', async () => {
    const resources = new MockEc2CloudResourceRepository();
    await seedStoppedInstanceWithVolume(resources, undefined, '2026-08-10T10:00:00.000Z');
    const observations = new MockEvidenceObservationRepository();

    class FailingMaturityRepository extends MockEvidenceMaturityRepository {
      override async recordAssessment(): Promise<never> {
        throw new Error('maturity persist failed');
      }
    }

    const costRepo = new MockEc2CostRepository({
      recommendationNow: () => new Date('2026-08-10T12:00:00.000Z'),
    });
    const persistence = new EvidencePersistenceService(observations);
    const maturity = new EvidenceMaturityService(new FailingMaturityRepository(), observations);
    const orchestrator = new Ec2CostAnalysisOrchestrator(
      resources,
      costRepo,
      costRepo,
      persistence,
      maturity,
    );

    const result = await orchestrator.run({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-maturity-fail',
      requestedAt: '2026-08-10T11:00:00.000Z',
      startedAt: '2026-08-10T11:00:00.000Z',
      metricsClientFactory: buildEmptyMetricsFactory(),
    });
    assert.ok(result.warnings.some((warning) => warning.includes('Evidence maturity assessment failed')));

    const findingKey = buildEc2CostFindingKey({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'us-east-1',
      resourceId: RESOURCE_ID_STOPPED,
      category: 'STOPPED_WITH_STORAGE',
      ruleVersion: '1.0.0',
    });
    const history = await observations.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey,
    });
    assert.equal(history.items.length, 1);
  });

  it('duplicate maturity invocation is idempotent', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const service = new EvidenceMaturityService(maturityRepo, observations);
    const recorded = await observations.recordObservation(
      buildRecordEvidenceObservationInput({
        category: 'STOPPED_WITH_STORAGE',
        ruleId: 'ec2.cost.stopped_with_storage',
      }),
    );
    const first = await service.evaluateAndPersist({
      observation: recorded.observation,
      evaluatedAt: FIXED_OBSERVATION_TS_1,
    });
    const second = await service.evaluateAndPersist({
      observation: recorded.observation,
      evaluatedAt: FIXED_OBSERVATION_TS_1,
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.record.assessmentId, second.record.assessmentId);
  });
});
