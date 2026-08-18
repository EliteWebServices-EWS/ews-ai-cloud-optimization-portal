import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateConfidence,
  CONFIDENCE_FORMULA_VERSION,
  CONFIDENCE_MODEL_VERSION,
  CONFIDENCE_REASON,
  DEFAULT_CONFIDENCE_CONFIG,
} from '../../engines/confidence';
import type { ConfidenceLongitudinalEvidence, EvidenceValidationResult, StandardizedEvidence } from '../../shared/types';
import {
  buildHealthyEvidence,
  buildHealthyValidation,
  RESOURCE_ID_CONFIDENCE_GOLDEN,
} from '../fixtures/evidence';
import {
  buildCompleteLongitudinalEvidence,
  buildImmatureMaturityEvidence,
  buildMatureMaturityEvidence,
  buildMissingPreviousPersistenceEvidence,
  buildStablePersistenceEvidence,
} from '../fixtures/evidence/confidence-longitudinal-evidence';

function withGovernanceContext(
  longitudinalEvidence: ConfidenceLongitudinalEvidence,
): ConfidenceLongitudinalEvidence {
  return {
    ...longitudinalEvidence,
    governanceConvergence: {
      contextAvailable: true,
      ruleVersion: 'governance-convergence-v1',
    },
  };
}
import { generateReport } from '../../engines/reporting/report.generator';
import {
  CONFIDENCE_STATUS,
  PLUGIN_NAMES,
  RECOMMENDATION_STATUS,
  WORKFLOW_STATES,
} from '../../shared/constants';
import type { ReportGenerationInput } from '../../shared/types';
import { buildConfidenceResult } from '../fixtures/evidence';

const evidence: StandardizedEvidence = buildHealthyEvidence();
const validation: EvidenceValidationResult = buildHealthyValidation();

function calculate(input: {
  evidence?: StandardizedEvidence;
  validation?: EvidenceValidationResult;
  longitudinalEvidence?: ConfidenceLongitudinalEvidence;
}) {
  return calculateConfidence({
    evidence: input.evidence ?? evidence,
    validation: input.validation ?? validation,
    resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
    config: DEFAULT_CONFIDENCE_CONFIG,
    longitudinalEvidence: input.longitudinalEvidence,
  });
}

describe('confidence consumer and semantic hardening', () => {
  it('keeps score and commercialScore aligned to the frozen raw commercial calculation', () => {
    const result = calculate({ longitudinalEvidence: buildCompleteLongitudinalEvidence() });
    assert.equal(result.score, result.commercialScore);
    assert.equal(result.level, result.status.toLowerCase() as typeof result.level);
  });

  it('applies legacy fallback MEDIUM ceiling for raw 100 without longitudinal evidence', () => {
    const withRecommendation = calculate({});
    assert.equal(withRecommendation.score, 100);
    assert.equal(withRecommendation.status, 'MEDIUM');
    assert.ok(withRecommendation.reasonCodes.includes(CONFIDENCE_REASON.PERSISTENCE_HISTORY_ABSENT));
    assert.ok(withRecommendation.reasonCodes.includes(CONFIDENCE_REASON.LEGACY_COMMERCIAL_FALLBACK));
    assert.ok(withRecommendation.reasonCodes.includes(CONFIDENCE_REASON.STATUS_CEILING_APPLIED));
  });

  it('applies legacy fallback MEDIUM ceiling for raw 88 without longitudinal evidence', () => {
    const absentRecommendation = calculate({
      evidence: { ...evidence, recommendations: [] },
    });
    assert.equal(absentRecommendation.score, 88);
    assert.equal(absentRecommendation.status, 'MEDIUM');
    assert.ok(absentRecommendation.reasonCodes.includes(CONFIDENCE_REASON.PERSISTENCE_HISTORY_ABSENT));
    assert.ok(absentRecommendation.reasonCodes.includes(CONFIDENCE_REASON.STATUS_CEILING_APPLIED));
  });

  it('uses authoritative persistence score 0 when provider recommendation is present', () => {
    const persistence = buildMissingPreviousPersistenceEvidence();
    const result = calculate({
      longitudinalEvidence: withGovernanceContext({
        persistence,
        maturity: buildImmatureMaturityEvidence({
          sourceObservationId: persistence.sourceObservationId,
          sourceLogicalObservationId: persistence.logicalObservationId,
          sourcePersistenceState: persistence.state,
          persistenceHours: persistence.persistenceHours,
          evidenceCompleteness: 'COMPLETE',
        }),
      }),
    });

    assert.equal(
      result.factors.find((factor) => factor.name === 'recommendation-persistence')?.score,
      0,
    );
    assert.equal(result.score, 85);
  });

  it('uses authoritative persistence score 100 when provider recommendation is absent', () => {
    const persistence = buildStablePersistenceEvidence();
    const result = calculate({
      evidence: { ...evidence, recommendations: [] },
      longitudinalEvidence: withGovernanceContext({
        persistence,
        maturity: buildMatureMaturityEvidence({
          sourceObservationId: persistence.sourceObservationId,
          sourceLogicalObservationId: persistence.logicalObservationId,
          sourcePersistenceState: persistence.state,
          persistenceHours: persistence.persistenceHours,
        }),
      }),
    });

    assert.equal(
      result.factors.find((factor) => factor.name === 'recommendation-persistence')?.score,
      100,
    );
    assert.equal(result.score, 100);
    assert.ok(!result.reasonCodes.includes(CONFIDENCE_REASON.PERSISTENCE_PROVIDER_HINT_FALLBACK));
  });

  it('does not treat missing maturity as MATURE when persistence is supplied', () => {
    const result = calculate({
      longitudinalEvidence: {
        persistence: buildStablePersistenceEvidence(),
        governanceConvergence: { contextAvailable: true },
      },
    });

    assert.equal(result.score, 100);
    assert.equal(result.status, 'HIGH');
    assert.ok(!result.reasonCodes.includes(CONFIDENCE_REASON.MATURITY_MATURE));
    assert.ok(!result.reasonCodes.includes(CONFIDENCE_REASON.MATURITY_PARTIAL));
    assert.ok(!result.reasonCodes.includes(CONFIDENCE_REASON.MATURITY_IMMATURE));
  });

  it('does not treat missing persistence as STABLE when only maturity is supplied', () => {
    const result = calculate({
      longitudinalEvidence: {
        maturity: buildMatureMaturityEvidence(),
      },
    });

    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.PERSISTENCE_HISTORY_ABSENT));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.LEGACY_COMMERCIAL_FALLBACK));
    assert.equal(result.status, 'MEDIUM');
  });

  it('applies LOW ceiling when persistence and maturity sourcePersistenceState contradict', () => {
    const persistence = buildStablePersistenceEvidence();
    const result = calculate({
      longitudinalEvidence: withGovernanceContext({
        persistence,
        maturity: buildMatureMaturityEvidence({
          sourceObservationId: persistence.sourceObservationId,
          sourceLogicalObservationId: persistence.logicalObservationId,
          sourcePersistenceState: 'CHANGED',
          persistenceHours: persistence.persistenceHours,
        }),
      }),
    });

    assert.equal(result.score, 100);
    assert.equal(result.status, 'LOW');
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.PERSISTENCE_MATURITY_STATE_MISMATCH));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.STATUS_CEILING_APPLIED));
  });

  it('ignores maturity qualification when source observation ids mismatch', () => {
    const result = calculate({
      longitudinalEvidence: {
        persistence: buildStablePersistenceEvidence({ sourceObservationId: 'obs-a' }),
        maturity: buildMatureMaturityEvidence({ sourceObservationId: 'obs-b' }),
        governanceConvergence: { contextAvailable: true },
      },
    });

    assert.equal(result.status, 'HIGH');
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.MATURITY_SOURCE_OBSERVATION_MISMATCH));
    assert.ok(!result.reasonCodes.includes(CONFIDENCE_REASON.MATURITY_MATURE));
  });

  it('accepts matching null persistenceHours on aligned persistence and maturity slices', () => {
    const persistence = buildStablePersistenceEvidence({
      state: 'NEW',
      persistenceHours: null,
      sourceObservationId: 'obs-new-aligned',
      logicalObservationId: 'logical-new-aligned',
    });
    const result = calculate({
      longitudinalEvidence: withGovernanceContext({
        persistence,
        maturity: buildImmatureMaturityEvidence({
          sourceObservationId: persistence.sourceObservationId,
          sourceLogicalObservationId: persistence.logicalObservationId,
          sourcePersistenceState: persistence.state,
          persistenceHours: null,
        }),
      }),
    });

    assert.ok(!result.reasonCodes.includes(CONFIDENCE_REASON.PERSISTENCE_HOURS_MISMATCH));
  });

  it('applies LOW ceiling when aligned persistence and maturity persistenceHours disagree', () => {
    const persistence = buildStablePersistenceEvidence({ persistenceHours: 48 });
    const result = calculate({
      longitudinalEvidence: withGovernanceContext({
        persistence,
        maturity: buildMatureMaturityEvidence({
          sourceObservationId: persistence.sourceObservationId,
          sourceLogicalObservationId: persistence.logicalObservationId,
          sourcePersistenceState: persistence.state,
          persistenceHours: 24,
        }),
      }),
    });

    assert.equal(result.score, 100);
    assert.equal(result.status, 'LOW');
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.PERSISTENCE_HOURS_MISMATCH));
    assert.ok(result.reasonCodes.includes(CONFIDENCE_REASON.STATUS_CEILING_APPLIED));
  });

  it('yields identical reasonCodes regardless of longitudinalEvidence property order', () => {
    const persistence = buildStablePersistenceEvidence();
    const maturity = buildMatureMaturityEvidence();
    const governance = { contextAvailable: true as const, ruleVersion: 'governance-convergence-v1' };

    const orderedA = calculate({
      longitudinalEvidence: { persistence, maturity, governanceConvergence: governance },
    });
    const orderedB = calculate({
      longitudinalEvidence: { governanceConvergence: governance, maturity, persistence },
    });

    assert.deepEqual(orderedA.reasonCodes, orderedB.reasonCodes);
    assert.deepEqual(orderedA, orderedB);
  });

  it('includes dual version metadata on every v2 result', () => {
    const result = calculate({});
    assert.equal(result.formulaVersion, CONFIDENCE_FORMULA_VERSION);
    assert.equal(result.confidenceModelVersion, CONFIDENCE_MODEL_VERSION);
  });

  it('preserves confidence audit provenance in report decision summaries', () => {
    const confidence = buildConfidenceResult({
      score: 100,
      commercialScore: 100,
      status: CONFIDENCE_STATUS.MEDIUM,
      level: 'medium',
      reasonCodes: [CONFIDENCE_REASON.LEGACY_COMMERCIAL_FALLBACK, CONFIDENCE_REASON.STATUS_CEILING_APPLIED],
    });

    const report = generateReport({
      tenantId: 'tenant-a',
      workflowId: 'wf-report-001',
      plugin: PLUGIN_NAMES.EC2,
      status: WORKFLOW_STATES.COMPLETED,
      region: 'us-east-1',
      completedAt: '2026-08-18T00:00:00.000Z',
      candidate: {
        resourceId: RESOURCE_ID_CONFIDENCE_GOLDEN,
        resourceType: 'EC2',
        region: 'us-east-1',
      },
      confidence,
      recommendation: {
        status: RECOMMENDATION_STATUS.RECOMMENDED,
        summary: 'Resize instance',
        reason: 'Approved',
        detail: {
          action: 'rightsizing',
          fromInstanceType: 't3.medium',
          toInstanceType: 't3.small',
          description: 'Resize from t3.medium to t3.small',
        },
        explanation: {
          governance: 'Approved',
          financial: 'Savings available',
          confidence: confidence.reason,
        },
        reasons: [],
      },
    } satisfies ReportGenerationInput);

    const decision = report.recommendations[0]?.decision;
    assert.equal(decision?.confidenceScore, 100);
    assert.equal(decision?.confidenceStatus, CONFIDENCE_STATUS.MEDIUM);
    assert.equal(decision?.confidenceFormulaVersion, CONFIDENCE_FORMULA_VERSION);
    assert.equal(decision?.confidenceModelVersion, CONFIDENCE_MODEL_VERSION);
    assert.deepEqual(decision?.confidenceReasonCodes, confidence.reasonCodes);
  });
});
