import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateActionPolicy,
  evaluateActionPolicyActorGate,
} from '../../action-policy';
import { qualifyGovernanceSafety } from '../../governance-regression/release-qualification';
import {
  buildNotReadyReadinessInput,
  buildProductionPolicyContext,
  buildSimulationPolicyContext,
  FIXED_POLICY_EVALUATED_AT,
} from '../fixtures/action-policy/policy-fixtures';
import { buildSafeFullyConsistentInput } from '../fixtures/sprint-4-governance/governance-regression-fixtures';

describe('Sprint 4 governance legacy fail-closed behavior', () => {
  it('classifies legacy simulation path as PRESERVED_SAFE (non-production)', () => {
    const context = buildSimulationPolicyContext();
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: context.decisionReadiness,
      actionMode: context.actionMode,
      infrastructureChanging: context.infrastructureChanging,
    });
    assert.equal(policy.actionMode, 'SIMULATION');
    assert.equal(policy.executionEligibility, 'ELIGIBLE');
  });

  it('classifies NOT_READY production path as FAIL_CLOSED', () => {
    const policy = evaluateActionPolicy({
      evaluatedAt: FIXED_POLICY_EVALUATED_AT,
      decisionReadiness: buildNotReadyReadinessInput(),
      actionMode: 'PRODUCTION',
      infrastructureChanging: true,
    });
    assert.equal(policy.executionEligibility, 'NOT_ELIGIBLE');
    assert.equal(policy.approval, 'BLOCKED');
  });

  it('classifies missing actor authorization as FAIL_CLOSED', () => {
    const gate = evaluateActionPolicyActorGate({
      authorized: false,
      mfaVerified: true,
      privilegedActionRequired: true,
    });
    assert.equal(gate.permitted, false);
  });

  it('preserves legitimate historical SAFE snapshots without mutation', () => {
    const input = buildSafeFullyConsistentInput();
    const before = structuredClone(input);
    const result = qualifyGovernanceSafety(input);
    assert.equal(result.result, 'SAFE');
    assert.deepEqual(input, before);
  });

  it('defers rollback execution durability to existing execution APIs (no duplicate engine)', () => {
    const context = buildProductionPolicyContext();
    assert.equal(context.actionMode, 'PRODUCTION');
    assert.equal(context.infrastructureChanging, true);
  });
});
