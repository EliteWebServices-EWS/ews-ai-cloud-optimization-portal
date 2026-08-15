import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateConfidence,
  CONFIDENCE_FORMULA_VERSION,
  DEFAULT_CONFIDENCE_CONFIG,
} from '../../engines/confidence';
import { PersistenceDataQualityError } from '../../persistence-intelligence/errors';
import { MockEvidenceObservationRepository } from '../../repositories/mock/mock-evidence-observation-repository';
import {
  ALL_NAMED_PERSISTENCE_SCENARIOS,
  buildChangedRecommendationScenario,
  buildDuplicateObservationScenario,
  buildGovernanceFailureResult,
  buildHealthyEvidence,
  buildHealthyValidation,
  buildIncompleteEvidence,
  buildIncompleteValidation,
  buildMalformedObservationScenario,
  buildManyHistoricalObservations,
  buildMissingPreviousScenario,
  buildMissingPricingEvidence,
  buildMissingPricingValidation,
  buildMlIneligibleDecision,
  buildNewRecommendationScenario,
  buildNoDataEvidence,
  buildNoDataValidation,
  buildPersistentRecommendationScenario,
  buildPostActionDegradationVerification,
  buildPostActionSuccessVerification,
  buildRecordEvidenceObservationInput,
  replayPersistenceScenario,
  RESOURCE_ID_CONFIDENCE_GOLDEN,
  TENANT_A,
  TENANT_B,
  ACCOUNT_A,
} from '../fixtures/evidence';

describe('canonical evidence fixture catalogue', () => {
  it('returns fresh StandardizedEvidence objects on each call', () => {
    const first = buildHealthyEvidence();
    const second = buildHealthyEvidence();
    first.telemetry.cpuUtilization = 99;
    assert.notEqual(second.telemetry.cpuUtilization, 99);
  });

  it('buildHealthyEvidence preserves golden confidence baseline inputs', () => {
    const result = calculateConfidence({
      evidence: buildHealthyEvidence(),
      validation: buildHealthyValidation(),
      resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });
    assert.equal(result.score, 100);
    assert.equal(result.status, 'HIGH');
    assert.equal(result.formulaVersion, CONFIDENCE_FORMULA_VERSION);
  });

  it('buildIncompleteEvidence and validation remain distinct from engine INCOMPLETE status', () => {
    const evidence = buildIncompleteEvidence();
    const validation = buildIncompleteValidation();
    assert.equal(validation.valid, false);
    assert.ok(evidence.metrics.utilizationHistory.length === 0);
  });

  it('buildNoDataEvidence produces empty metric series', () => {
    const evidence = buildNoDataEvidence();
    assert.equal(evidence.metrics.datapoints, 0);
    assert.equal(evidence.recommendations.length, 0);
    assert.equal(buildNoDataValidation().valid, false);
  });

  it('buildMissingPricingEvidence pairs with invalid validation fixture', () => {
    assert.equal(buildMissingPricingValidation().valid, false);
    assert.equal(buildMissingPricingEvidence().pricing.instanceType, '');
  });

  it('buildGovernanceFailureResult uses rejected governance decision', () => {
    const governance = buildGovernanceFailureResult();
    assert.equal(governance.decision, 'rejected');
    assert.equal(governance.status, 'NOT_READY');
  });

  it('buildMlIneligibleDecision is fixture-only Sprint 3 representation', () => {
    const decision = buildMlIneligibleDecision();
    assert.equal(decision.eligibility, 'ML_INELIGIBLE');
    assert.equal(decision.outcome, 'SKIPPED');
  });

  it('lifecycle verification fixtures use existing VerificationResult contract', () => {
    assert.equal(buildPostActionSuccessVerification().status, 'verified');
    assert.equal(buildPostActionDegradationVerification().status, 'partial');
  });

  it('replays named persistence scenarios through MockEvidenceObservationRepository', async () => {
    for (const scenario of ALL_NAMED_PERSISTENCE_SCENARIOS) {
      const repo = new MockEvidenceObservationRepository();
      const results = await replayPersistenceScenario(repo, scenario);
      assert.deepEqual(
        results.map((entry) => entry.state),
        scenario.expectedStates,
        scenario.name,
      );
    }
  });

  it('buildNewRecommendationScenario classifies first observation as NEW', async () => {
    const repo = new MockEvidenceObservationRepository();
    const results = await replayPersistenceScenario(repo, buildNewRecommendationScenario());
    assert.deepEqual(results, [{ created: true, state: 'NEW' }]);
  });

  it('buildPersistentRecommendationScenario follows NEW → STABLE → STABLE', async () => {
    const repo = new MockEvidenceObservationRepository();
    const results = await replayPersistenceScenario(
      repo,
      buildPersistentRecommendationScenario(),
    );
    assert.deepEqual(
      results.map((entry) => entry.state),
      ['NEW', 'STABLE', 'STABLE'],
    );
  });

  it('buildChangedRecommendationScenario follows NEW → CHANGED', async () => {
    const repo = new MockEvidenceObservationRepository();
    const results = await replayPersistenceScenario(repo, buildChangedRecommendationScenario());
    assert.deepEqual(results.map((entry) => entry.state), ['NEW', 'CHANGED']);
  });

  it('buildMissingPreviousScenario returns MISSING_PREVIOUS', async () => {
    const repo = new MockEvidenceObservationRepository();
    const results = await replayPersistenceScenario(repo, buildMissingPreviousScenario());
    assert.deepEqual(results, [{ created: true, state: 'MISSING_PREVIOUS' }]);
  });

  it('buildDuplicateObservationScenario idempotently replays the same logical observation', async () => {
    const repo = new MockEvidenceObservationRepository();
    const results = await replayPersistenceScenario(repo, buildDuplicateObservationScenario());
    assert.equal(results[0]?.created, true);
    assert.equal(results[1]?.created, false);
    assert.equal(results[0]?.state, 'NEW');
    assert.equal(results[1]?.state, 'NEW');
  });

  it('buildManyHistoricalObservations supports 100+ prior rows', async () => {
    const repo = new MockEvidenceObservationRepository();
    const history = buildManyHistoricalObservations(101);
    for (const input of history.slice(0, 100)) {
      await repo.recordObservation(input);
    }
    const current = await repo.recordObservation(history[100]!);
    assert.equal(current.assessment.state, 'STABLE');
  });

  it('buildMalformedObservationScenario rejects invalid timestamps at repository boundary', async () => {
    const repo = new MockEvidenceObservationRepository();
    const scenario = buildMalformedObservationScenario();
    await assert.rejects(
      () => repo.recordObservation(scenario.inputs[0]!),
      PersistenceDataQualityError,
    );
  });

  it('tenant fixture identities are deterministic and distinct', () => {
    assert.equal(TENANT_A, 'tenant-a');
    assert.equal(TENANT_B, 'tenant-b');
    assert.notEqual(TENANT_A, TENANT_B);
    assert.equal(buildRecordEvidenceObservationInput().tenantId, TENANT_A);
    assert.equal(
      buildRecordEvidenceObservationInput({ identity: { tenantId: TENANT_B, accountId: ACCOUNT_A } })
        .tenantId,
      TENANT_B,
    );
  });
});
