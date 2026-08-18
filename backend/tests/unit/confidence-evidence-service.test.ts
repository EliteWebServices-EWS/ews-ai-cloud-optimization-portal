import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfidenceEvidenceService } from '../../services/confidence-evidence-service';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import { MockEvidenceMaturityRepository } from '../../repositories/mock/mock-evidence-maturity-repository';
import {
  ACCOUNT_A,
  buildNewRecommendationScenario,
  TENANT_A,
} from '../fixtures/evidence';
import { EVIDENCE_MATURITY_MODEL_VERSION } from '../../evidence-maturity/model-version';
import { evaluateEvidenceMaturity } from '../../evidence-maturity';

describe('ConfidenceEvidenceService', () => {
  it('composes authoritative persistence and maturity slices from persisted records', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepository = new MockEvidenceMaturityRepository();
    const scenario = buildNewRecommendationScenario();
    const observationResult = await observations.recordObservation(scenario.inputs[0]!);
    const observation = observationResult.observation;

    const assessment = evaluateEvidenceMaturity({
      sourceObservation: observation,
      findingHistory: [observation],
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
      evaluatedAt: observation.collectionTimestamp,
    });
    await maturityRepository.recordAssessment(assessment);

    const service = new ConfidenceEvidenceService(observations, maturityRepository);
    const composed = await service.compose({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: observation.findingKey,
      sourceObservationId: observation.observationId,
      governanceContextAvailable: true,
    });

    assert.ok(composed?.persistence);
    assert.equal(composed.persistence?.state, 'NEW');
    assert.ok(composed?.maturity);
    assert.equal(composed.maturity?.modelVersion, EVIDENCE_MATURITY_MODEL_VERSION);
    assert.equal(composed.governanceConvergence?.contextAvailable, true);
  });

  it('returns undefined when no observations exist for the finding key', async () => {
    const service = new ConfidenceEvidenceService(
      new MockEvidenceObservationRepository(),
      new MockEvidenceMaturityRepository(),
    );

    const composed = await service.compose({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: 'finding/does-not-exist',
    });

    assert.equal(composed, undefined);
  });

  it('omits maturity when persisted maturity refers to a different source observation', async () => {
    const observations = new MockEvidenceObservationRepository();
    const maturityRepository = new MockEvidenceMaturityRepository();
    const scenario = buildNewRecommendationScenario();
    const observationResult = await observations.recordObservation(scenario.inputs[0]!);
    const observation = observationResult.observation;

    const assessment = evaluateEvidenceMaturity({
      sourceObservation: observation,
      findingHistory: [observation],
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
      evaluatedAt: observation.collectionTimestamp,
    });
    await maturityRepository.recordAssessment({
      ...assessment,
      sourceObservationId: 'different-observation-id',
    });

    const service = new ConfidenceEvidenceService(observations, maturityRepository);
    const composed = await service.compose({
      tenantId: TENANT_A,
      accountId: ACCOUNT_A,
      findingKey: observation.findingKey,
      sourceObservationId: observation.observationId,
    });

    assert.ok(composed?.persistence);
    assert.equal(composed?.maturity, undefined);
  });
});
