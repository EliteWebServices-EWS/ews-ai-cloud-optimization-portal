import type { VerificationRecord } from '../repositories/models/persistence-models';
import type { VerificationOutput } from '../engines/verification/verification.repository';
import type { PostActionVerificationAssessment } from './types';

/**
 * Sprint 3 repository convergence boundary:
 * - VerificationEngine persists full VerificationOutput via engine repository (authoritative for post-action flow).
 * - Generic VerificationRecord remains available for versioned platform persistence via explicit adapter only.
 */
export function toVerificationRecordFromOutput(
  output: VerificationOutput,
): VerificationRecord {
  return {
    tenantId: output.tenantId,
    verificationId: `${output.workflowId}:${output.executionId}`,
    workflowId: output.workflowId,
    outcome: output.assessment?.outcome ?? output.result.status,
    payload: {
      executionId: output.executionId,
      accountId: output.accountId ?? null,
      legacyStatus: output.result.status,
      assessment: output.assessment ?? null,
      expectation: output.expectation,
      observation: output.observation,
      result: output.result,
      recordedAt: output.recordedAt,
    },
    createdAt: output.recordedAt,
    updatedAt: output.recordedAt,
    version: 1,
  };
}

export function extractAssessmentFromOutput(
  output: VerificationOutput | null | undefined,
): PostActionVerificationAssessment | null {
  return output?.assessment ?? null;
}
