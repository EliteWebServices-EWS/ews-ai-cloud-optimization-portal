import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectGovernanceContradictions } from '../../governance-regression/contradiction-detector';
import { GOVERNANCE_CONTRADICTION, GOVERNANCE_SAFETY_REASON } from '../../governance-regression/reason-codes';
import { qualifyGovernanceSafety } from '../../governance-regression/release-qualification';
import { ACCOUNT_A, TENANT_A } from '../fixtures/evidence/identities';
import {
  buildBlockedRollbackWithoutAuthorizationInput,
  buildInsufficientMissingTelemetryInput,
  buildSafeFullyConsistentInput,
} from '../fixtures/sprint-4-governance/governance-regression-fixtures';

describe('Sprint 4 governance rollback authorization boundary', () => {
  it('A: ROLLBACK_CANDIDATE + no authorization + otherwise safe → SAFE', () => {
    const input = buildSafeFullyConsistentInput({
      verification: {
        postActionOutcome: 'ROLLBACK_CANDIDATE',
        verificationEvidenceSufficient: true,
      },
      rollback: {
        rollbackCandidate: true,
        rollbackAuthorized: false,
        rollbackInvokedByVerification: false,
        mlAuthorizedRollback: false,
      },
    });

    const result = qualifyGovernanceSafety(input);

    assert.equal(result.result, 'SAFE');
    assert.ok(result.reasonCodes.includes(GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_SAFE));
    assert.equal(input.rollback?.rollbackAuthorized, false);
    assert.equal(input.rollback?.rollbackInvokedByVerification, false);
    assert.equal(input.rollback?.mlAuthorizedRollback, false);
  });

  it('B: ROLLBACK_CANDIDATE + unauthorized rollback authorization → BLOCKED', () => {
    const result = qualifyGovernanceSafety(buildBlockedRollbackWithoutAuthorizationInput());

    assert.equal(result.result, 'BLOCKED');
    if (result.result === 'BLOCKED') {
      assert.ok(
        result.contradictions.some(
          (item) =>
            item.code ===
            GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ROLLBACK_WITHOUT_AUTHORIZATION,
        ),
      );
    }
    assert.ok(
      result.reasonCodes.includes(
        GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_CONTRADICTION_DETECTED,
      ),
    );
  });

  it('C: ML attempts to authorize rollback → BLOCKED', () => {
    const result = qualifyGovernanceSafety({
      ...buildSafeFullyConsistentInput(),
      rollback: {
        rollbackCandidate: true,
        rollbackAuthorized: true,
        mlAuthorizedRollback: true,
        rollbackActorAuthorized: true,
        rollbackMfaVerified: true,
        rollbackAttributionPresent: true,
        rollbackInvokedByVerification: false,
      },
    });

    assert.equal(result.result, 'BLOCKED');
    if (result.result === 'BLOCKED') {
      assert.ok(
        result.contradictions.some(
          (item) =>
            item.code ===
            GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ML_AUTHORIZED_ROLLBACK,
        ),
      );
    }
  });

  it('D: verification attempts to authorize rollback → BLOCKED', () => {
    const result = qualifyGovernanceSafety({
      ...buildSafeFullyConsistentInput(),
      rollback: {
        rollbackCandidate: true,
        rollbackAuthorized: false,
        rollbackInvokedByVerification: true,
        rollbackActorAuthorized: true,
        rollbackMfaVerified: true,
        rollbackAttributionPresent: true,
        mlAuthorizedRollback: false,
      },
    });

    assert.equal(result.result, 'BLOCKED');
    if (result.result === 'BLOCKED') {
      assert.ok(
        result.contradictions.some(
          (item) =>
            item.code ===
            GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ROLLBACK_WITHOUT_AUTHORIZATION,
        ),
      );
    }
  });

  it('E: cross-tenant rollback authorization → BLOCKED', () => {
    const result = qualifyGovernanceSafety({
      ...buildSafeFullyConsistentInput(),
      scope: {
        tenantId: TENANT_A,
        accountId: ACCOUNT_A,
        scopeVerified: false,
      },
      rollback: {
        rollbackCandidate: true,
        rollbackAuthorized: true,
        rollbackActorAuthorized: true,
        rollbackMfaVerified: true,
        rollbackAttributionPresent: true,
        rollbackInvokedByVerification: false,
        mlAuthorizedRollback: false,
      },
    });

    assert.equal(result.result, 'BLOCKED');
    if (result.result === 'BLOCKED') {
      assert.ok(
        result.contradictions.some(
          (item) =>
            item.code === GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_CROSS_TENANT_SCOPE,
        ),
      );
    }
    assert.ok(
      result.reasonCodes.includes(
        GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_CROSS_TENANT_DENIED,
      ),
    );
  });

  it('F1: rollback authorization claimed without candidate evidence → BLOCKED', () => {
    const result = qualifyGovernanceSafety({
      ...buildSafeFullyConsistentInput(),
      rollback: {
        rollbackCandidate: false,
        rollbackAuthorized: true,
        rollbackActorAuthorized: true,
        rollbackMfaVerified: true,
        rollbackAttributionPresent: true,
        rollbackInvokedByVerification: false,
        mlAuthorizedRollback: false,
      },
    });

    assert.equal(result.result, 'BLOCKED');
    if (result.result === 'BLOCKED') {
      assert.ok(
        result.contradictions.some(
          (item) =>
            item.code ===
            GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ROLLBACK_WITHOUT_AUTHORIZATION,
        ),
      );
    }
  });

  it('F2: advisory ROLLBACK_CANDIDATE with missing telemetry does not upgrade to BLOCKED by itself', () => {
    const result = qualifyGovernanceSafety({
      ...buildInsufficientMissingTelemetryInput(),
      verification: {
        postActionOutcome: 'ROLLBACK_CANDIDATE',
        verificationEvidenceSufficient: true,
      },
      rollback: {
        rollbackCandidate: true,
        rollbackAuthorized: false,
        rollbackInvokedByVerification: false,
        mlAuthorizedRollback: false,
      },
    });

    assert.equal(result.result, 'INSUFFICIENT_EVIDENCE');
    assert.ok(
      result.reasonCodes.includes(
        GOVERNANCE_SAFETY_REASON.GOVERNANCE_SAFETY_INSUFFICIENT_TELEMETRY,
      ),
    );
    assert.notEqual(result.result, 'BLOCKED');
  });

  it('ROLLBACK_CANDIDATE never implies rollback authorization in contradiction detection', () => {
    const contradictions = detectGovernanceContradictions(
      buildSafeFullyConsistentInput({
        verification: { postActionOutcome: 'ROLLBACK_CANDIDATE' },
        rollback: {
          rollbackCandidate: true,
          rollbackAuthorized: false,
        },
      }),
    );
    assert.equal(contradictions.length, 0);
  });
});
