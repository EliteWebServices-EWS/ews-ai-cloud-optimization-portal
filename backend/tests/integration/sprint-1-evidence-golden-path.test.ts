import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Ec2CostAnalysisOrchestrator } from '../../cloud-intelligence/ec2-cost/ec2-cost-analysis-orchestrator';
import {
  calculateConfidence,
  CONFIDENCE_FORMULA_VERSION,
  DEFAULT_CONFIDENCE_CONFIG,
} from '../../engines/confidence';
import { createConfidenceEngine } from '../../engines/confidence';
import { EVIDENCE_STATUS, FINANCIAL_STATUS, GOVERNANCE_STATUS, READINESS_STATUS } from '../../shared/constants';
import type { ConfidenceRequest } from '../../shared/types';
import { MockEc2CloudResourceRepository } from '../../repositories/mock/mock-ec2-cloud-resource-repository';
import { MockEc2CostRepository } from '../../repositories/mock/mock-ec2-cost-repository';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import { EvidencePersistenceService } from '../../services/evidence-persistence-service';
import {
  ACCOUNT_A,
  buildEmptyMetricsFactory,
  buildHealthyEvidence,
  buildHealthyValidation,
  buildStoppedInstanceFindingKey,
  RESOURCE_ID_CONFIDENCE_GOLDEN,
  RESOURCE_ID_STOPPED,
  seedStoppedInstanceWithVolume,
  TENANT_A,
} from '../fixtures/evidence';

function buildConfidenceEngineRequest(): ConfidenceRequest {
  return {
    context: {
      tenantId: TENANT_A,
      workflowId: 'workflow-golden-path',
      plugin: 'ec2',
      provider: 'mock',
      region: 'us-east-1',
      mode: 'demo',
      startedAt: '2026-08-07T00:00:00.000Z',
    },
    candidate: {
      resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
      resourceType: 'EC2',
      region: 'us-east-1',
    },
    evidence: buildHealthyEvidence(),
    evidenceStatus: EVIDENCE_STATUS.COMPLETE,
    validation: buildHealthyValidation(),
    governance: {
      status: READINESS_STATUS.READY,
      decision: GOVERNANCE_STATUS.APPROVED,
      readinessScore: 100,
      readiness: { score: 100, status: READINESS_STATUS.READY, factors: [] },
      reason: 'Governance passed',
      policies: [],
    },
    financialImpact: {
      currentMonthlyCost: 30,
      projectedMonthlyCost: 24,
      monthlySavings: 6,
      annualSavings: 72,
      percentageReduction: 20,
      status: FINANCIAL_STATUS.ESTIMATED,
      currency: 'USD',
      summary: {
        pricing: {
          region: 'us-east-1',
          current: {
            instanceType: 't3.medium',
            hourlyRate: 0.0416,
            monthlyCost: 30,
            currency: 'USD',
          },
          projected: {
            instanceType: 't3.small',
            hourlyRate: 0.0208,
            monthlyCost: 24,
            currency: 'USD',
          },
        },
        savings: {
          monthlySavings: 6,
          annualSavings: 72,
          percentageReduction: 20,
        },
        roi: 20,
        status: FINANCIAL_STATUS.ESTIMATED,
      },
      currentCost: 30,
      recommendedCost: 24,
      roi: 20,
    },
  };
}

describe('Sprint 1 evidence golden path (implemented paths only)', () => {
  it('IMPLEMENTED: workflow evidence → frozen commercial confidence baseline', async () => {
    const direct = calculateConfidence({
      evidence: buildHealthyEvidence(),
      validation: buildHealthyValidation(),
      resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });
    assert.equal(direct.score, 100);
    assert.equal(direct.status, 'HIGH');
    assert.equal(direct.formulaVersion, CONFIDENCE_FORMULA_VERSION);

    const engine = createConfidenceEngine();
    const engineResult = await engine.execute(buildConfidenceEngineRequest());
    assert.equal(engineResult.success, true);
    assert.equal(engineResult.data?.score, 100);
    assert.equal(engineResult.data?.formulaVersion, CONFIDENCE_FORMULA_VERSION);
  });

  it('IMPLEMENTED: EC2 cost analysis → evidence observation → recommendation persistence', async () => {
    const resources = new MockEc2CloudResourceRepository();
    await seedStoppedInstanceWithVolume(resources);
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

    const first = await orchestrator.run({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      regions: ['us-east-1'],
      observationDays: 14,
      runId: 'run-golden-1',
      requestedAt: '2026-08-10T11:00:00.000Z',
      startedAt: '2026-08-10T11:00:00.000Z',
      metricsClientFactory: buildEmptyMetricsFactory(),
    });
    assert.equal(first.recommendationsCreated, 1);

    const findingKey = buildStoppedInstanceFindingKey();
    const history = await observations.listObservationsForFinding({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey,
    });
    const recommendation = await costRepo.getRecommendationByScope({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      region: 'us-east-1',
      category: 'STOPPED_WITH_STORAGE',
      resourceId: RESOURCE_ID_STOPPED,
      ruleVersion: '1.0.0',
    });

    assert.equal(history.items.length, 1);
    assert.equal(history.items[0]!.assessment.state, 'NEW');
    assert.ok(recommendation);
    assert.equal(history.items[0]!.recommendationId, recommendation.recommendationId);
  });

  it('DOCUMENTED BOUNDARY: persistence states are not commercial confidence inputs in Sprint 1', () => {
    const evidenceWithoutLongitudinalPersistence = buildHealthyEvidence({
      recommendations: [],
    });
    const confidence = calculateConfidence({
      evidence: evidenceWithoutLongitudinalPersistence,
      validation: buildHealthyValidation(),
      resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });
    assert.equal(confidence.score, 88);
    assert.equal(confidence.status, 'HIGH');
    assert.match(confidence.reason, /recommendation-persistence/i);
  });
});
