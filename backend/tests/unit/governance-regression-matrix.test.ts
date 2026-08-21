import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateActionPolicy } from '../../action-policy/evaluate-action-policy';
import { evaluateSprint2DecisionReadiness } from '../../decision-readiness/readiness-policy';
import { qualifyGovernanceSafety } from '../../governance-regression/release-qualification';
import { GOVERNANCE_SAFETY_REASON } from '../../governance-regression/reason-codes';
import { VERIFICATION_STATUS } from '../../shared/constants';
import { evaluatePostActionVerification } from '../../post-action-verification/evaluate-post-action-verification';
import {
  buildReadyReadinessInput,
  FIXED_POLICY_EVALUATED_AT,
} from '../fixtures/action-policy/policy-fixtures';
import {
  buildHighConfidenceMatureEvidenceInput,
  buildGovernanceMissingContext,
  buildGovernancePreservedContext,
} from '../fixtures/evidence/decision-readiness-scenarios';
import {
  buildBlockedGovernanceFailExecutionEligibleInput,
  buildBlockedMissingApprovalInput,
  buildInsufficientMissingTelemetryInput,
  buildSafeFullyConsistentInput,
} from '../fixtures/sprint-4-governance/governance-regression-fixtures';
import { buildPostActionInsufficientEvidenceInput } from '../fixtures/sprint-3-lifecycle/sprint-3-lifecycle-fixtures';

function buildReadinessEvaluation(overrides: {
  maturity?: 'MATURE' | 'IMMATURE' | 'PARTIAL';
  confidenceStatus?: 'HIGH' | 'MEDIUM' | 'LOW';
  governance?: ReturnType<typeof buildGovernancePreservedContext>;
}) {
  const evidence = buildHighConfidenceMatureEvidenceInput();
  return evaluateSprint2DecisionReadiness({
    tenantId: 'tenant-a',
    accountId: '111122223333',
    findingKey: 'fk',
    recommendationCategory: 'BURSTABLE_CREDIT_PRESSURE',
    recommendationId: 'rec-1',
    recommendedAction: 'Rightsize',
    resourceId: evidence.resourceId,
    evaluatedAt: '2026-08-12T12:00:00.000Z',
    validation: evidence.validation,
    longitudinalEvidenceAvailable: true,
    persistence: {
      state: 'STABLE',
      persistenceHours: 24,
      reasonCodes: ['PERSISTENCE_FINGERPRINT_UNCHANGED'],
      sourceObservationId: 'obs-1',
      logicalObservationId: 'log-1',
      ruleId: 'ec2-cost-underutilized',
      ruleVersion: '1.0.0',
    },
    maturity: {
      maturity: overrides.maturity ?? 'MATURE',
      reasonCodes: [],
      modelVersion: 'evidence-maturity-v1',
      sourceObservationId: 'obs-1',
      sourceLogicalObservationId: 'log-1',
      stableEpochObservationCount: 3,
      stableEpochHours: 30,
      persistenceHours: 24,
    },
    governance: {
      convergence: overrides.governance ?? buildGovernancePreservedContext(),
    },
    confidence: {
      status: overrides.confidenceStatus ?? 'HIGH',
      score: overrides.confidenceStatus === 'LOW' ? 20 : 100,
      commercialScore: overrides.confidenceStatus === 'LOW' ? 20 : 100,
      reasonCodes: [],
      formulaVersion: 'commercial-weighted-v1',
      confidenceModelVersion: 'confidence-evidence-aware-v2',
    },
  });
}

describe('Sprint 4 governance regression matrix', () => {
  it('recommendation without mature evidence remains NOT_READY at readiness layer', () => {
    const readiness = buildReadinessEvaluation({ maturity: 'IMMATURE' });
    assert.equal(readiness.readiness, 'NOT_READY');
  });

  it('mature evidence + governance failure blocks execution eligibility', () => {
    const result = qualifyGovernanceSafety(buildBlockedGovernanceFailExecutionEligibleInput());
    assert.equal(result.result, 'BLOCKED');
  });

  it('governance pass + insufficient confidence remains NOT_READY upstream', () => {
    const readiness = buildReadinessEvaluation({ confidenceStatus: 'LOW' });
    assert.equal(readiness.readiness, 'NOT_READY');
  });

  it('NOT_READY + high ML confidence cannot execute in action policy', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput({ readiness: 'NOT_READY' }),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
      mlDecisionSummary: {
        eligibility: 'ML_ELIGIBLE',
        outcome: 'EXECUTED',
        fallback: 'NONE',
        modelVersion: 'model-v1',
      },
    });
    assert.equal(policy.executionEligibility, 'NOT_ELIGIBLE');
  });

  it('ML unavailable deterministic fallback preserves approval requirement', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildReadyReadinessInput(),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
      mlDecisionSummary: {
        eligibility: 'ML_INELIGIBLE',
        outcome: 'SKIPPED',
        fallback: 'DETERMINISTIC_RULES',
      },
    });
    assert.equal(policy.approval, 'REQUIRED');
    assert.equal(policy.executionEligibility, 'NOT_ELIGIBLE');
  });

  it('governance failure with READY snapshot is blocked at qualification layer', () => {
    const readiness = buildReadinessEvaluation({
      governance: buildGovernanceMissingContext(),
    });
    assert.equal(readiness.readiness, 'NOT_READY');
  });

  it('missing approval blocks unsafe terminal execution state', () => {
    const result = qualifyGovernanceSafety(buildBlockedMissingApprovalInput());
    assert.equal(result.result, 'BLOCKED');
  });

  it('verification insufficient evidence does not become RESOLVED', () => {
    const fixture = buildPostActionInsufficientEvidenceInput();
    const assessment = evaluatePostActionVerification({
      ...fixture.assessmentInput,
      comparatorResult: {
        status: VERIFICATION_STATUS.PENDING,
        expectedSavings: 10,
        actualSavings: 0,
        verifiedSavings: 0,
        variance: -10,
        variancePercentage: -100,
        stateMatched: false,
      },
    });
    assert.equal(assessment.outcome, 'INSUFFICIENT_EVIDENCE');
    assert.notEqual(assessment.outcome, 'RESOLVED');
  });

  it('telemetry unavailable yields INSUFFICIENT_EVIDENCE qualification', () => {
    const result = qualifyGovernanceSafety(buildInsufficientMissingTelemetryInput());
    assert.equal(result.result, 'INSUFFICIENT_EVIDENCE');
    assert.ok(
      result.reasonCodes.includes(
        GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_INSUFFICIENT_TELEMETRY,
      ),
    );
  });

  it('fully consistent lifecycle qualifies SAFE', () => {
    const result = qualifyGovernanceSafety(buildSafeFullyConsistentInput());
    assert.equal(result.result, 'SAFE');
  });
});
