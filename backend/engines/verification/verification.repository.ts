/** Tenant-scoped persistence boundary for Verification Engine outputs. */
import type {
  Observation,
  VerificationExpectation,
  VerificationResult,
} from '../../shared/types';

/** Complete, durable representation of a verification decision. */
export interface VerificationOutput {
  tenantId: string;
  workflowId: string;
  executionId: string;
  expectation: VerificationExpectation;
  observation: Observation;
  result: VerificationResult;
  recordedAt: string;
}

export interface VerificationRepository {
  save(output: VerificationOutput): Promise<VerificationOutput>;
  findByWorkflowId(tenantId: string, workflowId: string): Promise<VerificationOutput | undefined>;
  findByExecutionId(tenantId: string, executionId: string): Promise<VerificationOutput | undefined>;
  list(tenantId: string): Promise<VerificationOutput[]>;
}
