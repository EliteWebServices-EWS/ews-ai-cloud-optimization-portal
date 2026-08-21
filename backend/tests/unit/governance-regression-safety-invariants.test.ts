import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isGovernanceFailed,
  isGovernanceFailWithExecutionEligible,
  isImmatureWithReady,
  isMissingPricingForQualification,
  isMissingTelemetryForQualification,
  isNotReadyWithExecutionEligible,
} from '../../governance-regression/safety-invariants';

describe('Sprint 4 governance safety invariants', () => {
  it('IMMATURE ≠ READY', () => {
    assert.equal(
      isImmatureWithReady({ maturity: 'IMMATURE', readiness: 'READY' }),
      true,
    );
    assert.equal(
      isImmatureWithReady({ maturity: 'MATURE', readiness: 'READY' }),
      false,
    );
  });

  it('NOT_READY cannot execute when marked ELIGIBLE', () => {
    assert.equal(
      isNotReadyWithExecutionEligible({
        intelligence: { readiness: 'NOT_READY' },
        executionEligibility: 'ELIGIBLE',
      }),
      true,
    );
  });

  it('governance FAIL cannot become execution eligible', () => {
    assert.equal(
      isGovernanceFailed({
        readiness: 'READY',
        governanceConvergenceState: 'MISSING',
        governanceContextAvailable: true,
      }),
      true,
    );
    assert.equal(
      isGovernanceFailWithExecutionEligible({
        intelligence: {
          readiness: 'READY',
          governanceConvergenceState: 'MISSING',
          governanceContextAvailable: true,
        },
        executionEligibility: 'ELIGIBLE',
      }),
      true,
    );
  });

  it('HIGH confidence ≠ APPROVED is enforced at qualification layer via contradiction flags', () => {
    assert.equal(
      isGovernanceFailed({
        readiness: 'READY',
        legacyGovernancePolicyStatus: 'FAIL',
      }),
      true,
    );
  });

  it('missing telemetry and pricing are distinct insufficient-evidence signals', () => {
    assert.equal(
      isMissingTelemetryForQualification({
        readiness: 'NOT_READY',
        telemetryEvidenceAvailable: false,
      }),
      true,
    );
    assert.equal(
      isMissingPricingForQualification({
        readiness: 'NOT_READY',
        pricingEvidenceAvailable: false,
      }),
      true,
    );
  });
});
