import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectGovernanceContradictions } from '../../governance-regression/contradiction-detector';
import { GOVERNANCE_CONTRADICTION } from '../../governance-regression/reason-codes';
import {
  buildBlockedGovernanceFailExecutionEligibleInput,
  buildBlockedImmatureReadyContradictionInput,
  buildBlockedMissingApprovalInput,
  buildBlockedRollbackWithoutAuthorizationInput,
  buildCrossTenantDecisionDeniedInput,
  buildMlHighNonAuthorityInput,
  buildSafeFullyConsistentInput,
} from '../fixtures/sprint-4-governance/governance-regression-fixtures';

describe('Sprint 4 governance contradiction detector', () => {
  it('returns no contradictions for SAFE_FULLY_CONSISTENT snapshot', () => {
    const contradictions = detectGovernanceContradictions(buildSafeFullyConsistentInput());
    assert.equal(contradictions.length, 0);
  });

  it('detects IMMATURE + READY contradiction', () => {
    const contradictions = detectGovernanceContradictions(
      buildBlockedImmatureReadyContradictionInput(),
    );
    assert.ok(
      contradictions.some(
        (item) =>
          item.code === GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_IMMATURE_WITH_READY,
      ),
    );
  });

  it('detects governance FAIL + execution ELIGIBLE contradiction', () => {
    const contradictions = detectGovernanceContradictions(
      buildBlockedGovernanceFailExecutionEligibleInput(),
    );
    assert.ok(
      contradictions.some(
        (item) =>
          item.code ===
          GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_GOVERNANCE_FAIL_EXECUTION_ELIGIBLE,
      ),
    );
  });

  it('detects missing approval execution contradiction', () => {
    const contradictions = detectGovernanceContradictions(
      buildBlockedMissingApprovalInput(),
    );
    assert.ok(
      contradictions.some(
        (item) =>
          item.code ===
          GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_MISSING_APPROVAL_EXECUTION,
      ),
    );
  });

  it('detects rollback without authorization boundary', () => {
    const contradictions = detectGovernanceContradictions(
      buildBlockedRollbackWithoutAuthorizationInput(),
    );
    assert.ok(
      contradictions.some(
        (item) =>
          item.code ===
          GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ROLLBACK_WITHOUT_AUTHORIZATION,
      ),
    );
  });

  it('detects ML authority contradiction', () => {
    const contradictions = detectGovernanceContradictions(buildMlHighNonAuthorityInput());
    assert.ok(
      contradictions.some(
        (item) =>
          item.code ===
          GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_ML_EXECUTED_IS_AUTHORITY,
      ),
    );
  });

  it('detects cross-tenant scope contradiction', () => {
    const contradictions = detectGovernanceContradictions(
      buildCrossTenantDecisionDeniedInput(),
    );
    assert.ok(
      contradictions.some(
        (item) =>
          item.code === GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_CROSS_TENANT_SCOPE,
      ),
    );
  });

  it('detects NOT_READY + execution ELIGIBLE contradiction', () => {
    const contradictions = detectGovernanceContradictions({
      ...buildSafeFullyConsistentInput(),
      intelligence: {
        maturity: 'MATURE',
        readiness: 'NOT_READY',
        governanceConvergenceState: 'PRESERVED',
        governanceContextAvailable: true,
        confidenceStatus: 'HIGH',
        pricingEvidenceAvailable: true,
        telemetryEvidenceAvailable: true,
      },
      policy: {
        actionPolicyApproval: 'BLOCKED',
        actionPolicyExecutionEligibility: 'ELIGIBLE',
        actionPolicyReadiness: 'NOT_READY',
      },
    });
    assert.ok(
      contradictions.some(
        (item) =>
          item.code ===
          GOVERNANCE_CONTRADICTION.GOVERNANCE_CONTRADICTION_NOT_READY_EXECUTION_ELIGIBLE,
      ),
    );
  });

  it('does not mutate contradictory inputs', () => {
    const input = buildBlockedImmatureReadyContradictionInput();
    const before = structuredClone(input);
    detectGovernanceContradictions(input);
    assert.deepEqual(input, before);
  });
});
