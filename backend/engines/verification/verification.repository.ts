/** Tenant-scoped persistence boundary for Verification Engine outputs. */
import type { PostActionVerificationAssessment } from '../../post-action-verification/types';
import type {
  Observation,
  VerificationExpectation,
  VerificationResult,
} from '../../shared/types';

/** Complete, durable representation of a verification decision. */
export interface VerificationOutput {
  tenantId: string;
  /** Sprint 3 trusted account scope — never inferred from workflow/execution identifiers. */
  accountId?: string;
  workflowId: string;
  executionId: string;
  expectation: VerificationExpectation;
  observation: Observation | null;
  result: VerificationResult;
  recordedAt: string;
  /** Sprint 3 enterprise post-action assessment composed from legacy comparator output. */
  assessment?: PostActionVerificationAssessment;
}

export interface VerificationRepository {
  save(output: VerificationOutput): Promise<VerificationOutput>;
  findByWorkflowId(tenantId: string, workflowId: string): Promise<VerificationOutput | undefined>;
  findByExecutionId(tenantId: string, executionId: string): Promise<VerificationOutput | undefined>;
  list(tenantId: string): Promise<VerificationOutput[]>;
}
