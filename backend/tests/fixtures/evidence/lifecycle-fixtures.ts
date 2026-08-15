import { VERIFICATION_STATUS } from '../../../shared/constants';
import type { Observation, VerificationResult } from '../../../shared/types';
import { REGION, RESOURCE_ID_A } from './identities';

function buildBaseObservation(): Observation {
  return {
    resourceId: RESOURCE_ID_A,
    resourceType: 'EC2',
    region: REGION,
    collectedAt: '2026-08-14T12:00:00.000Z',
    instanceType: 't3.small',
    previousInstanceType: 't3.medium',
    monthlyCostBefore: 30,
    monthlyCostAfter: 15,
    observedMonthlySavings: 15,
    metrics: [
      {
        name: 'monthlyCost',
        expected: 15,
        observed: 15,
        unit: 'USD',
        matched: true,
      },
    ],
    executionId: 'exec-fixture-success',
    source: 'simulated',
  };
}

/**
 * Sprint 4 support fixture — uses existing VerificationResult contract only.
 * Does not execute verification logic.
 */
export function buildPostActionSuccessVerification(): VerificationResult {
  return {
    status: VERIFICATION_STATUS.VERIFIED,
    expectedSavings: 15,
    actualSavings: 15,
    verifiedSavings: 15,
    variance: 0,
    variancePercentage: 0,
    stateMatched: true,
    message: 'Optimization savings verified',
  };
}

/**
 * Sprint 4 support fixture — degraded post-action outcome using PARTIAL status.
 */
export function buildPostActionDegradationVerification(): VerificationResult {
  return {
    status: VERIFICATION_STATUS.PARTIAL,
    expectedSavings: 15,
    actualSavings: 5,
    verifiedSavings: 5,
    variance: 10,
    variancePercentage: 66.67,
    stateMatched: false,
    message: 'Observed savings below expectation',
  };
}

export function buildPostActionSuccessObservation(): Observation {
  return structuredClone(buildBaseObservation());
}

export function buildPostActionDegradationObservation(): Observation {
  return structuredClone({
    ...buildBaseObservation(),
    monthlyCostAfter: 25,
    observedMonthlySavings: 5,
    metrics: [
      {
        name: 'monthlyCost',
        expected: 15,
        observed: 25,
        unit: 'USD',
        matched: false,
      },
    ],
    executionId: 'exec-fixture-degraded',
  });
}
