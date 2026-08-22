import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectContradictions, GOVERNANCE_REGRESSION_REASON } from '../../governance-regression-eng2';
import { ACCOUNT_A, ACCOUNT_B, TENANT_A, TENANT_B } from '../fixtures/evidence/identities';
import { buildSafeBaselineSnapshot } from '../fixtures/sprint-4-governance-regression-eng2-alt/regression-matrix-fixtures';

describe('Governance regression — Task 4 contradiction detection', () => {
  it('baseline snapshot has no contradictions', () => {
    assert.deepEqual(detectContradictions(buildSafeBaselineSnapshot()), []);
  });

  it('detects Maturity IMMATURE + readiness READY', () => {
    const snapshot = buildSafeBaselineSnapshot({
      evidenceMaturity: { available: true, maturity: 'IMMATURE' },
      decisionReadiness: { available: true, readiness: 'READY' },
    });
    const contradictions = detectContradictions(snapshot);
    assert.ok(
      contradictions.some(
        (c) =>
          c.code ===
          GOVERNANCE_REGRESSION_REASON.CONTRADICTION_MATURITY_IMMATURE_READINESS_READY,
      ),
    );
  });

  it('detects Governance FAIL + execution ELIGIBLE', () => {
    const snapshot = buildSafeBaselineSnapshot({
      governance: { contextAvailable: true, convergenceState: 'MISSING', legacyStatus: null },
      actionPolicy: {
        available: true,
        approval: 'NOT_REQUIRED',
        executionEligibility: 'ELIGIBLE',
        reasonCodes: [],
      },
    });
    const contradictions = detectContradictions(snapshot);
    assert.ok(
      contradictions.some(
        (c) =>
          c.code ===
          GOVERNANCE_REGRESSION_REASON.CONTRADICTION_GOVERNANCE_FAIL_EXECUTION_ELIGIBLE,
      ),
    );
  });

  it('detects legacy governance status FAIL + execution ELIGIBLE', () => {
    const snapshot = buildSafeBaselineSnapshot({
      governance: { contextAvailable: true, convergenceState: null, legacyStatus: 'FAIL' },
      actionPolicy: {
        available: true,
        approval: 'NOT_REQUIRED',
        executionEligibility: 'ELIGIBLE',
        reasonCodes: [],
      },
    });
    const contradictions = detectContradictions(snapshot);
    assert.ok(
      contradictions.some(
        (c) =>
          c.code ===
          GOVERNANCE_REGRESSION_REASON.CONTRADICTION_GOVERNANCE_FAIL_EXECUTION_ELIGIBLE,
      ),
    );
  });

  it('detects Approval REQUIRED + approvalStatus NOT_REQUIRED', () => {
    const snapshot = buildSafeBaselineSnapshot({
      actionPolicy: {
        available: true,
        approval: 'REQUIRED',
        executionEligibility: 'NOT_ELIGIBLE',
        reasonCodes: [],
      },
      approval: {
        available: true,
        approvalStatus: 'NOT_REQUIRED',
        approvalSource: 'NOT_APPLICABLE',
        approvalActorId: null,
        approvedAt: null,
      },
    });
    const contradictions = detectContradictions(snapshot);
    assert.ok(
      contradictions.some(
        (c) =>
          c.code ===
          GOVERNANCE_REGRESSION_REASON.CONTRADICTION_APPROVAL_REQUIRED_STATUS_NOT_REQUIRED,
      ),
    );
  });

  it('detects Verification INSUFFICIENT_EVIDENCE + RESOLVED', () => {
    const snapshot = buildSafeBaselineSnapshot({
      verification: {
        present: true,
        outcome: 'INSUFFICIENT_EVIDENCE',
        incorrectlyMarkedResolved: true,
      },
    });
    const contradictions = detectContradictions(snapshot);
    assert.ok(
      contradictions.some(
        (c) =>
          c.code ===
          GOVERNANCE_REGRESSION_REASON.CONTRADICTION_VERIFICATION_INSUFFICIENT_EVIDENCE_MARKED_RESOLVED,
      ),
    );
  });

  it('detects rollback evidence insufficient + ROLLBACK authorized', () => {
    const snapshot = buildSafeBaselineSnapshot({
      rollback: {
        candidateFlagged: true,
        evidenceSufficient: false,
        authorized: true,
        authorizedByActorId: 'actor-owner',
        authorizedAt: '2026-08-21T12:00:00.000Z',
        authorizedByMl: false,
        authorizedByVerificationDirectly: false,
      },
    });
    const contradictions = detectContradictions(snapshot);
    assert.ok(
      contradictions.some(
        (c) =>
          c.code ===
          GOVERNANCE_REGRESSION_REASON.CONTRADICTION_ROLLBACK_EVIDENCE_INSUFFICIENT_BUT_AUTHORIZED,
      ),
    );
  });

  it('detects cross-tenant decision input', () => {
    const snapshot = buildSafeBaselineSnapshot({
      scope: { tenantId: TENANT_A, accountId: ACCOUNT_A },
      observedRecordScopes: [
        { tenantId: TENANT_A, accountId: ACCOUNT_A },
        { tenantId: TENANT_B, accountId: ACCOUNT_B },
      ],
    });
    const contradictions = detectContradictions(snapshot);
    assert.ok(
      contradictions.some(
        (c) => c.code === GOVERNANCE_REGRESSION_REASON.CONTRADICTION_CROSS_TENANT_DECISION_INPUT,
      ),
    );
  });

  it('does not flag a same-tenant, different-account boundary as a contradiction it cannot express', () => {
    // Guard against false negatives: a record scoped to the same tenant but a
    // *different* account must still be caught (account-level isolation, not
    // just tenant-level).
    const snapshot = buildSafeBaselineSnapshot({
      scope: { tenantId: TENANT_A, accountId: ACCOUNT_A },
      observedRecordScopes: [{ tenantId: TENANT_A, accountId: ACCOUNT_B }],
    });
    const contradictions = detectContradictions(snapshot);
    assert.ok(
      contradictions.some(
        (c) => c.code === GOVERNANCE_REGRESSION_REASON.CONTRADICTION_CROSS_TENANT_DECISION_INPUT,
      ),
    );
  });

  it('does not silently mutate the input snapshot when a contradiction is found', () => {
    const snapshot = buildSafeBaselineSnapshot({
      evidenceMaturity: { available: true, maturity: 'IMMATURE' },
      decisionReadiness: { available: true, readiness: 'READY' },
    });
    const before = JSON.stringify(snapshot);
    detectContradictions(snapshot);
    assert.equal(JSON.stringify(snapshot), before);
  });
});
