import type {
  ExecutionResult,
  Observation,
  VerificationExpectation,
  VerificationResult,
} from '../../shared/types';
import { EXECUTION_STATUS, VERIFICATION_STATUS } from '../../shared/constants';
import type { VerificationConfig } from './verification.config';
import { DEFAULT_VERIFICATION_CONFIG } from './verification.config';

export interface ComparisonInput {
  executionResult: ExecutionResult;
  observation: Observation;
  expectation: VerificationExpectation;
  config?: VerificationConfig;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildMessage(
  status: VerificationResult['status'],
  stateMatched: boolean,
  savingsMatched: boolean,
  variancePercentage: number
): string {
  if (status === VERIFICATION_STATUS.PENDING) {
    return 'Verification pending — execution did not complete';
  }

  if (status === VERIFICATION_STATUS.VERIFIED) {
    return 'Optimization achieved expected impact.';
  }

  if (status === VERIFICATION_STATUS.PARTIAL) {
    if (!stateMatched) {
      return 'Partial success — observed instance type differs from expected target.';
    }
    return `Partial success — savings within ${Math.abs(variancePercentage).toFixed(1)}% of expected.`;
  }

  if (!stateMatched && !savingsMatched) {
    return 'Verification failed — observed state and savings do not match expected outcome.';
  }

  if (!stateMatched) {
    return 'Verification failed — observed resource state does not match expected target.';
  }

  return 'Verification failed — observed savings below expected threshold.';
}

/**
 * Compare expected optimization outcomes against observed post-execution data.
 * Deterministic rules — no provider calls, no side effects.
 */
export function compareVerificationOutcome(input: ComparisonInput): VerificationResult {
  const config = input.config ?? DEFAULT_VERIFICATION_CONFIG;
  const expectedSavings = roundCurrency(input.expectation.expectedMonthlySavings);
  const actualSavings = roundCurrency(input.observation.observedMonthlySavings);
  const variance = roundCurrency(actualSavings - expectedSavings);
  const variancePercentage =
    expectedSavings > 0 ? roundCurrency((variance / expectedSavings) * 100) : 0;

  const stateMatched =
    input.observation.instanceType === input.expectation.expectedInstanceType &&
    input.executionResult.change.to === input.expectation.expectedInstanceType;

  const savingsMatched = actualSavings >= expectedSavings;
  const withinVerifiedTolerance =
    Math.abs(variancePercentage) <= config.verifiedVarianceTolerancePercent;
  const withinPartialTolerance =
    Math.abs(variancePercentage) <= config.partialVarianceTolerancePercent;

  if (
    input.executionResult.status === EXECUTION_STATUS.SKIPPED ||
    input.executionResult.status === EXECUTION_STATUS.PENDING
  ) {
    return {
      status: VERIFICATION_STATUS.PENDING,
      expectedSavings,
      actualSavings,
      verifiedSavings: actualSavings,
      variance,
      variancePercentage,
      stateMatched,
      confidenceScore: 0,
      message: input.executionResult.message ?? 'Verification pending — execution was not completed',
    };
  }

  if (input.executionResult.status === EXECUTION_STATUS.FAILED) {
    return {
      status: VERIFICATION_STATUS.FAILED,
      expectedSavings,
      actualSavings,
      verifiedSavings: actualSavings,
      variance,
      variancePercentage,
      stateMatched,
      confidenceScore: config.failedConfidenceScore,
      message: input.executionResult.message ?? 'Verification failed — execution did not succeed',
    };
  }

  if (stateMatched && savingsMatched && withinVerifiedTolerance) {
    return {
      status: VERIFICATION_STATUS.VERIFIED,
      expectedSavings,
      actualSavings,
      verifiedSavings: actualSavings,
      variance,
      variancePercentage,
      stateMatched,
      confidenceScore: config.verifiedConfidenceScore,
      message: buildMessage(VERIFICATION_STATUS.VERIFIED, stateMatched, savingsMatched, variancePercentage),
    };
  }

  if (
    stateMatched &&
    actualSavings >= expectedSavings * (1 - config.partialVarianceTolerancePercent / 100) &&
    withinPartialTolerance
  ) {
    return {
      status: VERIFICATION_STATUS.PARTIAL,
      expectedSavings,
      actualSavings,
      verifiedSavings: actualSavings,
      variance,
      variancePercentage,
      stateMatched,
      confidenceScore: config.partialConfidenceScore,
      message: buildMessage(VERIFICATION_STATUS.PARTIAL, stateMatched, savingsMatched, variancePercentage),
    };
  }

  return {
    status: VERIFICATION_STATUS.FAILED,
    expectedSavings,
    actualSavings,
    verifiedSavings: actualSavings,
    variance,
    variancePercentage,
    stateMatched,
    confidenceScore: config.failedConfidenceScore,
    message: buildMessage(VERIFICATION_STATUS.FAILED, stateMatched, savingsMatched, variancePercentage),
  };
}
