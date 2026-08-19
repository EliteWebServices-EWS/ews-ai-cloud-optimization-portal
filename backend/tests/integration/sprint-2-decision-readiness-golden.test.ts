import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DecisionReadinessService } from '../../decision-readiness/decision-readiness-service';
import { DECISION_READINESS_REASON } from '../../decision-readiness/reason-codes';
import { MockEvidenceMaturityRepository } from '../../repositories/mock/mock-evidence-maturity-repository';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import {
  buildBurstableCreditPressurePersistenceScenario,
  buildGovernanceImprovedContext,
  buildGovernanceMissingContext,
  buildGovernancePreservedContext,
  buildGovernanceReplacedContext,
  buildHighConfidenceMatureEvidenceInput,
  buildImmatureNewPersistenceScenario,
  buildMatureStablePersistenceScenario,
  buildPartialStablePersistenceScenario,
  buildChangedRecommendationPersistenceScenario,
  buildMissingHistoryPersistenceScenario,
  replayCostEvidencePipeline,
} from '../fixtures/evidence';
import { buildAssessInputFromPipeline } from './sprint-2-decision-readiness-helpers';

describe('Sprint 2 decision-readiness golden scenarios', () => {
  it('MATURE_STABLE + GOVERNANCE_PRESERVED + HIGH → READY', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: buildMatureStablePersistenceScenario(),
    });
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const service = new DecisionReadinessService(observations, maturityRepo);

    const result = await service.assess(
      buildAssessInputFromPipeline({
        pipeline,
        ...evidence,
        governanceConvergence: buildGovernancePreservedContext(),
      }),
    );

    assert.equal(pipeline.lastPersistenceState, 'STABLE');
    assert.equal(pipeline.lastMaturity, 'MATURE');
    assert.equal(result.recommendationCategory, 'STOPPED_WITH_STORAGE');
    assert.equal(result.persistence.state, 'STABLE');
    assert.equal(result.maturity?.maturity, 'MATURE');
    assert.equal(result.confidence.status, 'HIGH');
    assert.equal(result.confidence.score, 100);
    assert.equal(result.readiness, 'READY');
    assert.equal(result.governance.convergence.state, 'PRESERVED');
    assert.ok(result.reasonCodes.includes(DECISION_READINESS_REASON.READY));
  });

  it('canonical BURSTABLE_CREDIT_PRESSURE preserves category and recommended action separately', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: buildBurstableCreditPressurePersistenceScenario(),
      currentPerformanceEvidence: { dataCompleteness: 'COMPLETE' },
    });
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const result = await new DecisionReadinessService(observations, maturityRepo).assess(
      buildAssessInputFromPipeline({
        pipeline,
        ...evidence,
        governanceConvergence: buildGovernancePreservedContext(),
      }),
    );

    assert.equal(result.recommendationCategory, 'BURSTABLE_CREDIT_PRESSURE');
    assert.match(result.recommendedAction, /burstable credit pressure/i);
    assert.notEqual(result.recommendationCategory, result.recommendedAction);
    assert.equal(result.readiness, 'READY');
    assert.equal(result.confidence.score, 100);
  });

  it('GOVERNANCE_IMPROVED is eligible for READY when other gates pass', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: buildMatureStablePersistenceScenario(),
    });
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const result = await new DecisionReadinessService(observations, maturityRepo).assess(
      buildAssessInputFromPipeline({
        pipeline,
        ...evidence,
        governanceConvergence: buildGovernanceImprovedContext(),
      }),
    );
    assert.equal(result.readiness, 'READY');
  });

  it('GOVERNANCE_REPLACED is eligible for READY when other gates pass', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: buildMatureStablePersistenceScenario(),
    });
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const result = await new DecisionReadinessService(observations, maturityRepo).assess(
      buildAssessInputFromPipeline({
        pipeline,
        ...evidence,
        governanceConvergence: buildGovernanceReplacedContext(),
      }),
    );
    assert.equal(result.readiness, 'READY');
  });

  it('PARTIAL_STABLE → NOT_READY with maturity gate', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: buildPartialStablePersistenceScenario(),
    });
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const result = await new DecisionReadinessService(observations, maturityRepo).assess(
      buildAssessInputFromPipeline({
        pipeline,
        ...evidence,
        governanceConvergence: buildGovernancePreservedContext(),
      }),
    );

    assert.equal(pipeline.lastMaturity, 'PARTIAL');
    assert.equal(result.readiness, 'NOT_READY');
    assert.equal(result.confidence.status, 'MEDIUM');
  });

  it('IMMATURE_NEW → NOT_READY', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: buildImmatureNewPersistenceScenario(),
    });
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const result = await new DecisionReadinessService(observations, maturityRepo).assess(
      buildAssessInputFromPipeline({
        pipeline,
        ...evidence,
        governanceConvergence: buildGovernancePreservedContext(),
      }),
    );

    assert.equal(result.maturity?.maturity, 'IMMATURE');
    assert.equal(result.readiness, 'NOT_READY');
    assert.equal(result.confidence.status, 'LOW');
  });

  it('CHANGED_RECOMMENDATION → NOT_READY', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: buildChangedRecommendationPersistenceScenario(),
    });
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const result = await new DecisionReadinessService(observations, maturityRepo).assess(
      buildAssessInputFromPipeline({
        pipeline,
        ...evidence,
        governanceConvergence: buildGovernancePreservedContext(),
      }),
    );

    assert.equal(result.persistence.state, 'CHANGED');
    assert.equal(result.readiness, 'NOT_READY');
  });

  it('MISSING_HISTORY → NOT_READY', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: buildMissingHistoryPersistenceScenario(),
    });
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const result = await new DecisionReadinessService(observations, maturityRepo).assess(
      buildAssessInputFromPipeline({
        pipeline,
        ...evidence,
        governanceConvergence: buildGovernancePreservedContext(),
      }),
    );

    assert.equal(result.persistence.state, 'MISSING_PREVIOUS');
    assert.equal(result.readiness, 'NOT_READY');
  });

  it('GOVERNANCE_MISSING → NOT_READY', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: buildMatureStablePersistenceScenario(),
    });
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const result = await new DecisionReadinessService(observations, maturityRepo).assess(
      buildAssessInputFromPipeline({
        pipeline,
        ...evidence,
        governanceConvergence: buildGovernanceMissingContext(),
      }),
    );

    assert.equal(result.readiness, 'NOT_READY');
    assert.ok(result.reasonCodes.includes(DECISION_READINESS_REASON.GOVERNANCE_CONVERGENCE_MISSING));
  });

  it('identical input repeated yields deep-equal structured result', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepo = new MockEvidenceMaturityRepository();
    const pipeline = await replayCostEvidencePipeline({
      observations,
      maturityRepository: maturityRepo,
      scenario: buildMatureStablePersistenceScenario(),
    });
    const evidence = buildHighConfidenceMatureEvidenceInput();
    const service = new DecisionReadinessService(observations, maturityRepo);
    const assessInput = buildAssessInputFromPipeline({
      pipeline,
      ...evidence,
      governanceConvergence: buildGovernancePreservedContext(),
    });
    const first = await service.assess(assessInput);
    const second = await service.assess(assessInput);
    assert.deepEqual(first, second);
  });
});
