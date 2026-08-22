import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateSafetyInvariants, GOVERNANCE_REGRESSION_REASON } from '../../governance-regression-eng2';
import { buildSafeBaselineSnapshot } from '../fixtures/sprint-4-governance-regression-eng2-alt/regression-matrix-fixtures';

const FIXED_AT = '2026-08-21T12:00:00.000Z';

describe('Governance regression — Task 2 canonical safety invariants', () => {
  it('baseline snapshot violates nothing', () => {
    const violations = evaluateSafetyInvariants(buildSafeBaselineSnapshot());
    assert.deepEqual(violations, []);
  });

  it('IMMATURE ≠ READY', () => {
    const snapshot = buildSafeBaselineSnapshot({
      evidenceMaturity: { available: true, maturity: 'IMMATURE' },
      decisionReadiness: { available: true, readiness: 'READY' },
    });
    const violations = evaluateSafetyInvariants(snapshot);
    assert.ok(
      violations.some((v) => v.code === GOVERNANCE_REGRESSION_REASON.INVARIANT_IMMATURE_NOT_READY),
    );
  });

  it('NOT_READY cannot execute', () => {
    const snapshot = buildSafeBaselineSnapshot({
      decisionReadiness: { available: true, readiness: 'NOT_READY' },
      actionPolicy: {
        available: true,
        approval: 'NOT_REQUIRED',
        executionEligibility: 'ELIGIBLE',
        reasonCodes: [],
      },
    });
    const violations = evaluateSafetyInvariants(snapshot);
    assert.ok(
      violations.some(
        (v) => v.code === GOVERNANCE_REGRESSION_REASON.INVARIANT_NOT_READY_CANNOT_EXECUTE,
      ),
    );
  });

  it('governance FAIL cannot be overridden by execution eligibility', () => {
    const snapshot = buildSafeBaselineSnapshot({
      governance: { contextAvailable: true, convergenceState: 'MISSING', legacyStatus: null },
      actionPolicy: {
        available: true,
        approval: 'NOT_REQUIRED',
        executionEligibility: 'ELIGIBLE',
        reasonCodes: [],
      },
    });
    const violations = evaluateSafetyInvariants(snapshot);
    assert.ok(
      violations.some(
        (v) =>
          v.code ===
          GOVERNANCE_REGRESSION_REASON.INVARIANT_GOVERNANCE_FAIL_NOT_OVERRIDABLE_BY_ML,
      ),
    );
  });

  it('governance FAIL cannot be overridden by ML EXECUTED', () => {
    const snapshot = buildSafeBaselineSnapshot({
      governance: { contextAvailable: true, convergenceState: null, legacyStatus: 'FAIL' },
      mlDecision: { present: true, outcome: 'EXECUTED', actionPolicyRecordedNonAuthority: true },
    });
    const violations = evaluateSafetyInvariants(snapshot);
    assert.ok(
      violations.some(
        (v) =>
          v.code ===
          GOVERNANCE_REGRESSION_REASON.INVARIANT_GOVERNANCE_FAIL_NOT_OVERRIDABLE_BY_ML,
      ),
    );
  });

  it('HIGH confidence cannot substitute for recorded approval', () => {
    const snapshot = buildSafeBaselineSnapshot({
      confidence: { available: true, status: 'HIGH' },
      approval: {
        available: true,
        approvalStatus: 'APPROVED',
        approvalSource: 'INFERRED_FROM_CONFIDENCE',
        approvalActorId: null,
        approvedAt: null,
      },
    });
    const violations = evaluateSafetyInvariants(snapshot);
    assert.ok(
      violations.some(
        (v) => v.code === GOVERNANCE_REGRESSION_REASON.INVARIANT_HIGH_CONFIDENCE_NOT_APPROVAL,
      ),
    );
  });

  it('an APPROVED status with no attributable actor is unsafe regardless of confidence', () => {
    const snapshot = buildSafeBaselineSnapshot({
      approval: {
        available: true,
        approvalStatus: 'APPROVED',
        approvalSource: 'HUMAN_APPROVAL',
        approvalActorId: null,
        approvedAt: FIXED_AT,
      },
    });
    const violations = evaluateSafetyInvariants(snapshot);
    assert.ok(
      violations.some(
        (v) => v.code === GOVERNANCE_REGRESSION_REASON.INVARIANT_HIGH_CONFIDENCE_NOT_APPROVAL,
      ),
    );
  });

  it('ML EXECUTED without the non-authority reason code is unsafe', () => {
    const snapshot = buildSafeBaselineSnapshot({
      mlDecision: { present: true, outcome: 'EXECUTED', actionPolicyRecordedNonAuthority: false },
    });
    const violations = evaluateSafetyInvariants(snapshot);
    assert.ok(
      violations.some(
        (v) => v.code === GOVERNANCE_REGRESSION_REASON.INVARIANT_ML_EXECUTED_NOT_AUTHORITY,
      ),
    );
  });

  it('ML EXECUTED with the non-authority reason code recorded is safe', () => {
    const snapshot = buildSafeBaselineSnapshot({
      mlDecision: { present: true, outcome: 'EXECUTED', actionPolicyRecordedNonAuthority: true },
    });
    const violations = evaluateSafetyInvariants(snapshot);
    assert.equal(
      violations.some(
        (v) => v.code === GOVERNANCE_REGRESSION_REASON.INVARIANT_ML_EXECUTED_NOT_AUTHORITY,
      ),
      false,
    );
  });

  it('ML FAILED_SAFE must not weaken governance without the unchanged marker', () => {
    const snapshot = buildSafeBaselineSnapshot({
      mlDecision: { present: true, outcome: 'FAILED_SAFE', actionPolicyRecordedNonAuthority: false },
      actionPolicy: {
        available: true,
        approval: 'NOT_REQUIRED',
        executionEligibility: 'ELIGIBLE',
        reasonCodes: ['ACTION_POLICY_READINESS_READY'],
      },
    });
    const violations = evaluateSafetyInvariants(snapshot);
    assert.ok(
      violations.some(
        (v) =>
          v.code ===
          GOVERNANCE_REGRESSION_REASON.INVARIANT_ML_FAILED_SAFE_MUST_NOT_WEAKEN_GOVERNANCE,
      ),
    );
  });

  it('APPROVAL REQUIRED with missing approval cannot execute', () => {
    const snapshot = buildSafeBaselineSnapshot({
      actionPolicy: {
        available: true,
        approval: 'REQUIRED',
        executionEligibility: 'ELIGIBLE',
        reasonCodes: [],
      },
      approval: {
        available: true,
        approvalStatus: 'PENDING',
        approvalSource: 'NOT_APPLICABLE',
        approvalActorId: null,
        approvedAt: null,
      },
    });
    const violations = evaluateSafetyInvariants(snapshot);
    assert.ok(
      violations.some(
        (v) =>
          v.code ===
          GOVERNANCE_REGRESSION_REASON.INVARIANT_APPROVAL_REQUIRED_MISSING_CANNOT_EXECUTE,
      ),
    );
  });

  it('API execution success without verification evidence is unsafe', () => {
    const snapshot = buildSafeBaselineSnapshot({
      execution: { attempted: true, apiSuccess: true, providerFailure: false },
      verification: { present: false, outcome: null, incorrectlyMarkedResolved: false },
    });
    const violations = evaluateSafetyInvariants(snapshot);
    assert.ok(
      violations.some(
        (v) =>
          v.code === GOVERNANCE_REGRESSION_REASON.INVARIANT_API_SUCCESS_NOT_OPTIMIZATION_SUCCESS,
      ),
    );
  });

  it('INSUFFICIENT_EVIDENCE incorrectly marked resolved is unsafe', () => {
    const snapshot = buildSafeBaselineSnapshot({
      verification: {
        present: true,
        outcome: 'INSUFFICIENT_EVIDENCE',
        incorrectlyMarkedResolved: true,
      },
    });
    const violations = evaluateSafetyInvariants(snapshot);
    assert.ok(
      violations.some(
        (v) =>
          v.code ===
          GOVERNANCE_REGRESSION_REASON.INVARIANT_INSUFFICIENT_EVIDENCE_NOT_SUCCESSFUL_VERIFICATION,
      ),
    );
  });

  it('ROLLBACK_CANDIDATE alone cannot become authorization', () => {
    const snapshot = buildSafeBaselineSnapshot({
      rollback: {
        candidateFlagged: true,
        evidenceSufficient: true,
        authorized: true,
        authorizedByActorId: null,
        authorizedAt: null,
        authorizedByMl: false,
        authorizedByVerificationDirectly: false,
      },
    });
    const violations = evaluateSafetyInvariants(snapshot);
    assert.ok(
      violations.some(
        (v) =>
          v.code === GOVERNANCE_REGRESSION_REASON.INVARIANT_ROLLBACK_CANDIDATE_NOT_AUTHORIZATION,
      ),
    );
  });

  it('ML-authorized rollback is unsafe even with attribution fields present', () => {
    const snapshot = buildSafeBaselineSnapshot({
      rollback: {
        candidateFlagged: true,
        evidenceSufficient: true,
        authorized: true,
        authorizedByActorId: 'ml-model',
        authorizedAt: FIXED_AT,
        authorizedByMl: true,
        authorizedByVerificationDirectly: false,
      },
    });
    const violations = evaluateSafetyInvariants(snapshot);
    assert.ok(
      violations.some(
        (v) =>
          v.code === GOVERNANCE_REGRESSION_REASON.INVARIANT_ROLLBACK_CANDIDATE_NOT_AUTHORIZATION,
      ),
    );
  });

  it('verification-invoked rollback is unsafe', () => {
    const snapshot = buildSafeBaselineSnapshot({
      rollback: {
        candidateFlagged: true,
        evidenceSufficient: true,
        authorized: true,
        authorizedByActorId: 'verification-engine',
        authorizedAt: FIXED_AT,
        authorizedByMl: false,
        authorizedByVerificationDirectly: true,
      },
    });
    const violations = evaluateSafetyInvariants(snapshot);
    assert.ok(
      violations.some(
        (v) =>
          v.code === GOVERNANCE_REGRESSION_REASON.INVARIANT_ROLLBACK_CANDIDATE_NOT_AUTHORIZATION,
      ),
    );
  });

  it('a properly attributed human rollback authorization is safe', () => {
    const snapshot = buildSafeBaselineSnapshot({
      rollback: {
        candidateFlagged: true,
        evidenceSufficient: true,
        authorized: true,
        authorizedByActorId: 'actor-owner',
        authorizedAt: FIXED_AT,
        authorizedByMl: false,
        authorizedByVerificationDirectly: false,
      },
    });
    const violations = evaluateSafetyInvariants(snapshot);
    assert.equal(
      violations.some(
        (v) =>
          v.code === GOVERNANCE_REGRESSION_REASON.INVARIANT_ROLLBACK_CANDIDATE_NOT_AUTHORIZATION,
      ),
      false,
    );
  });
});
