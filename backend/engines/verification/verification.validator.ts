import type {
  ExecutionResult,
  Observation,
  VerificationExpectation,
} from '../../shared/types';
import { EXECUTION_STATUS, RECOMMENDATION_STATUS } from '../../shared/constants';
import { AppError } from '../../shared/utils';

export interface ValidationOutcome {
  valid: boolean;
  errors: string[];
}

/** Validate inputs required before verification comparison. */
export function validateVerificationInputs(input: {
  executionResult: ExecutionResult;
  observation: Observation;
  expectation: VerificationExpectation;
}): ValidationOutcome {
  const errors: string[] = [];

  if (!input.executionResult.executionId) {
    errors.push('Execution result is missing executionId');
  }

  if (!input.observation.resourceId) {
    errors.push('Observation is missing resourceId');
  }

  if (input.executionResult.resourceId !== input.observation.resourceId) {
    errors.push('Execution resourceId does not match observation resourceId');
  }

  if (input.expectation.expectedMonthlySavings < 0) {
    errors.push('Expected monthly savings cannot be negative');
  }

  if (
    input.executionResult.status === EXECUTION_STATUS.FAILED &&
    input.executionResult.metadata.recommendationStatus === RECOMMENDATION_STATUS.RECOMMENDED
  ) {
    errors.push('Execution failed for a recommended optimization');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/** Assert verification inputs are valid or throw a structured error. */
export function requireValidVerificationInputs(input: {
  executionResult: ExecutionResult;
  observation: Observation;
  expectation: VerificationExpectation;
}): void {
  const outcome = validateVerificationInputs(input);
  if (!outcome.valid) {
    throw new AppError('INVALID_OBSERVATION', outcome.errors.join('; '), 400);
  }
}
