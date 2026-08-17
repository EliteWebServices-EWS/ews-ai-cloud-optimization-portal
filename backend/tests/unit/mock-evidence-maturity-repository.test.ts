import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EVIDENCE_MATURITY_MODEL_VERSION } from '../../evidence-maturity/model-version';
import { evaluateEvidenceMaturity } from '../../evidence-maturity';
import { MockEvidenceMaturityRepository } from '../../repositories/mock/mock-evidence-maturity-repository';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import {
  ACCOUNT_A,
  ACCOUNT_B,
  TENANT_A,
  TENANT_B,
  buildPersistentRecommendationScenario,
  buildRecordEvidenceObservationInput,
  replayPersistenceScenario,
} from '../fixtures/evidence';

const EVALUATED_AT = '2026-08-12T12:10:00.000Z';

describe('MockEvidenceMaturityRepository', () => {
  it('creates and retrieves a maturity assessment', async () => {
    const observations = new MockEvidenceObservationRepository();
    await replayPersistenceScenario(observations, buildPersistentRecommendationScenario());
    const scenario = buildPersistentRecommendationScenario();
    const lastInput = scenario.inputs[scenario.inputs.length - 1]!;
    const page = await observations.listObservationsForFinding({
      tenantId: lastInput.tenantId,
      accountId: lastInput.accountId,
      findingKey: lastInput.findingKey,
      limit: 100,
    });
    const source = page.items[page.items.length - 1]!;
    const assessment = evaluateEvidenceMaturity({
      sourceObservation: source,
      findingHistory: page.items,
      telemetryApplicability: 'REQUIRED',
      dataCompleteness: 'COMPLETE',
      evaluatedAt: EVALUATED_AT,
    });

    const repo = new MockEvidenceMaturityRepository();
    const created = await repo.recordAssessment(assessment);
    assert.equal(created.created, true);
    assert.equal(created.record.modelVersion, EVIDENCE_MATURITY_MODEL_VERSION);

    const loaded = await repo.getAssessmentByLogicalKey({
      tenantId: assessment.tenantId,
      accountId: assessment.accountId,
      findingKey: assessment.findingKey,
      sourceLogicalObservationId: assessment.sourceLogicalObservationId,
      modelVersion: assessment.modelVersion,
    });
    assert.ok(loaded);
    assert.deepEqual(loaded.reasonCodes, assessment.reasonCodes);
    assert.equal(loaded.score, assessment.score);
    assert.deepEqual(loaded.stableEpochObservationIds, assessment.stableEpochObservationIds);
  });

  it('duplicate logical evaluation returns existing assessment', async () => {
    const repo = new MockEvidenceMaturityRepository();
    const observations = new MockEvidenceObservationRepository();
    const recorded = await observations.recordObservation(buildRecordEvidenceObservationInput());
    const assessment = evaluateEvidenceMaturity({
      sourceObservation: recorded.observation,
      findingHistory: [recorded.observation],
      telemetryApplicability: 'NOT_APPLICABLE',
      dataCompleteness: 'NOT_APPLICABLE',
      evaluatedAt: EVALUATED_AT,
    });
    const first = await repo.recordAssessment(assessment);
    const second = await repo.recordAssessment(assessment);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.record.assessmentId, second.record.assessmentId);
  });

  it('enforces tenant isolation', async () => {
    const repo = new MockEvidenceMaturityRepository();
    const observations = new MockEvidenceObservationRepository();
    const recorded = await observations.recordObservation(
      buildRecordEvidenceObservationInput({ identity: { tenantId: TENANT_A, accountId: ACCOUNT_A } }),
    );
    const assessment = evaluateEvidenceMaturity({
      sourceObservation: recorded.observation,
      findingHistory: [recorded.observation],
      telemetryApplicability: 'NOT_APPLICABLE',
      dataCompleteness: 'NOT_APPLICABLE',
      evaluatedAt: EVALUATED_AT,
    });
    await repo.recordAssessment(assessment);
    const crossTenant = await repo.getAssessmentByLogicalKey({
      tenantId: TENANT_B,
      accountId: ACCOUNT_A,
      findingKey: assessment.findingKey,
      sourceLogicalObservationId: assessment.sourceLogicalObservationId,
      modelVersion: assessment.modelVersion,
    });
    assert.equal(crossTenant, null);
  });

  it('enforces account isolation', async () => {
    const repo = new MockEvidenceMaturityRepository();
    const observations = new MockEvidenceObservationRepository();
    const recorded = await observations.recordObservation(
      buildRecordEvidenceObservationInput({ identity: { tenantId: TENANT_A, accountId: ACCOUNT_A } }),
    );
    const assessment = evaluateEvidenceMaturity({
      sourceObservation: recorded.observation,
      findingHistory: [recorded.observation],
      telemetryApplicability: 'NOT_APPLICABLE',
      dataCompleteness: 'NOT_APPLICABLE',
      evaluatedAt: EVALUATED_AT,
    });
    await repo.recordAssessment(assessment);
    const crossAccount = await repo.getAssessmentByLogicalKey({
      tenantId: TENANT_A,
      accountId: ACCOUNT_B,
      findingKey: assessment.findingKey,
      sourceLogicalObservationId: assessment.sourceLogicalObservationId,
      modelVersion: assessment.modelVersion,
    });
    assert.equal(crossAccount, null);
  });
});
