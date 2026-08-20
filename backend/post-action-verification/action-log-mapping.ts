import type { ActionLogEventType } from '../action-log/types';
import type { PostActionVerificationOutcome } from './types';

export function toActionLogVerificationEventType(
  outcome: PostActionVerificationOutcome,
): ActionLogEventType {
  if (outcome === 'INSUFFICIENT_EVIDENCE') {
    return 'VERIFICATION_INSUFFICIENT_EVIDENCE';
  }
  return 'VERIFICATION_COMPLETED';
}

export const REPOSITORY_CONVERGENCE_MODEL = {
  authoritative: 'engines/verification/verification.repository',
  genericAdapter: 'post-action-verification/repository-convergence.toVerificationRecordFromOutput',
  thirdRepositoryCreated: false,
} as const;
