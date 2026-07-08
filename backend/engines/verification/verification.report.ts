import type {
  Observation,
  VerificationExpectation,
  VerificationReport,
  VerificationResult,
} from '../../shared/types';

/** Build a human-readable verification report from comparison output. */
export function buildVerificationReport(input: {
  workflowId: string;
  executionId: string;
  expectation: VerificationExpectation;
  observation: Observation;
  result: VerificationResult;
}): VerificationReport {
  const summary = `${input.result.status.toUpperCase()}: ${input.result.message ?? 'Verification complete'}`;

  return {
    workflowId: input.workflowId,
    executionId: input.executionId,
    status: input.result.status,
    expected: input.expectation,
    observation: input.observation,
    result: input.result,
    generatedAt: new Date().toISOString(),
    summary,
  };
}
