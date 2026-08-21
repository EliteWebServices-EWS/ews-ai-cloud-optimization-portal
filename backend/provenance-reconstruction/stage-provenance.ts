import type { ActionLogSourceStage } from '../action-log/types';
import {
  requiresApproval,
  requiresExecution,
  requiresVerification,
} from './lifecycle-path';
import type { ProvenanceSourceReference } from './types';
import type { ActionLogRecord } from '../action-log/types';

export type StageProvenanceClass = 'ACTIONLOG_AUTHORITATIVE' | 'REFERENCE_ONLY';

export const STAGE_PROVENANCE_CLASS: Record<
  ActionLogSourceStage,
  StageProvenanceClass
> = {
  RECOMMENDATION: 'REFERENCE_ONLY',
  PERSISTENCE: 'REFERENCE_ONLY',
  MATURITY: 'REFERENCE_ONLY',
  GOVERNANCE: 'REFERENCE_ONLY',
  CONFIDENCE: 'REFERENCE_ONLY',
  DECISION_READINESS: 'REFERENCE_ONLY',
  ML: 'ACTIONLOG_AUTHORITATIVE',
  APPROVAL: 'REFERENCE_ONLY',
  EXECUTION: 'REFERENCE_ONLY',
  VERIFICATION: 'REFERENCE_ONLY',
};

export function getStageProvenanceClass(
  stage: ActionLogSourceStage,
): StageProvenanceClass {
  return STAGE_PROVENANCE_CLASS[stage];
}

export function isRequiredReferenceOnlySource(
  reference: ProvenanceSourceReference,
  events: readonly ActionLogRecord[],
): boolean {
  if (getStageProvenanceClass(reference.sourceStage) !== 'REFERENCE_ONLY') {
    return false;
  }

  switch (reference.sourceStage) {
    case 'APPROVAL':
      return requiresApproval(events);
    case 'EXECUTION':
      return requiresExecution(events);
    case 'VERIFICATION':
      return requiresVerification(events);
    default:
      return false;
  }
}
