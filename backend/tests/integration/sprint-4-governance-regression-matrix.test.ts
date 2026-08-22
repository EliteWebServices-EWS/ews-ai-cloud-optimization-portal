import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateReleaseSafetyGate, GOVERNANCE_REGRESSION_REASON } from '../../governance-regression-eng2';
import { REGRESSION_MATRIX_SCENARIOS } from '../fixtures/sprint-4-governance-regression-eng2-alt/regression-matrix-fixtures';

describe('Sprint 4 governance regression matrix (Task 3) — release safety gate', () => {
  for (const scenario of REGRESSION_MATRIX_SCENARIOS) {
    it(`${scenario.name} -> ${scenario.expected}`, () => {
      const gate = evaluateReleaseSafetyGate(scenario.build());
      assert.equal(
        gate.result,
        scenario.expected,
        `expected ${scenario.name} to resolve to ${scenario.expected}, got ${gate.result} (${gate.reasonCodes.join(', ')})`,
      );
    });
  }

  it('the full matrix runs deterministically twice with identical verdicts', () => {
    for (const scenario of REGRESSION_MATRIX_SCENARIOS) {
      const first = evaluateReleaseSafetyGate(scenario.build());
      const second = evaluateReleaseSafetyGate(scenario.build());
      assert.deepEqual(first, second, `${scenario.name} was non-deterministic`);
    }
  });

  it('every BLOCKED scenario carries at least one invariant violation or contradiction reason code', () => {
    for (const scenario of REGRESSION_MATRIX_SCENARIOS.filter((s) => s.expected === 'BLOCKED')) {
      const gate = evaluateReleaseSafetyGate(scenario.build());
      assert.ok(
        gate.reasonCodes.includes(GOVERNANCE_REGRESSION_REASON.GATE_BLOCKED_INVARIANT_VIOLATION) ||
          gate.reasonCodes.includes(GOVERNANCE_REGRESSION_REASON.GATE_BLOCKED_CONTRADICTION),
        `${scenario.name} was BLOCKED without a specific reason code`,
      );
    }
  });

  it('every INSUFFICIENT_EVIDENCE scenario carries the insufficient-evidence reason code and no unsafe verdict', () => {
    for (const scenario of REGRESSION_MATRIX_SCENARIOS.filter(
      (s) => s.expected === 'INSUFFICIENT_EVIDENCE',
    )) {
      const gate = evaluateReleaseSafetyGate(scenario.build());
      assert.ok(gate.reasonCodes.includes(GOVERNANCE_REGRESSION_REASON.GATE_INSUFFICIENT_EVIDENCE));
      assert.equal(gate.invariantViolations.length, 0);
      assert.equal(gate.contradictions.length, 0);
    }
  });

  it('a SAFE verdict never coexists with a recorded invariant violation or contradiction', () => {
    for (const scenario of REGRESSION_MATRIX_SCENARIOS.filter((s) => s.expected === 'SAFE')) {
      const gate = evaluateReleaseSafetyGate(scenario.build());
      assert.equal(gate.invariantViolations.length, 0);
      assert.equal(gate.contradictions.length, 0);
    }
  });
});
