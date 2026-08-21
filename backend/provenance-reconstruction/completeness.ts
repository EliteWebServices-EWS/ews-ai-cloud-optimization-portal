import type { ActionLogRecord, ActionLogSourceStage } from '../action-log/types';
import {
  isSimulationPath,
  requiresApproval,
  requiresExecution,
  requiresVerification,
} from './lifecycle-path';
import { PROVENANCE_REASON, type ProvenanceReasonCode } from './reason-codes';
import { isRequiredReferenceOnlySource } from './stage-provenance';
import type {
  ProvenanceCompleteness,
  ProvenanceSourceReference,
  SourceVerificationMode,
} from './types';

const EXECUTION_EVENT_TYPES = new Set([
  'EXECUTION_STARTED',
  'EXECUTION_SUCCEEDED',
  'EXECUTION_FAILED',
  'EXECUTION_SIMULATED',
]);

const VERIFICATION_EVENT_TYPES = new Set([
  'VERIFICATION_STARTED',
  'VERIFICATION_COMPLETED',
  'VERIFICATION_INSUFFICIENT_EVIDENCE',
]);

const APPROVAL_RESOLUTION_EVENT_TYPES = new Set([
  'APPROVAL_GRANTED',
  'APPROVAL_REJECTED',
  'APPROVAL_OVERRIDDEN',
]);

function hasEventType(
  events: readonly ActionLogRecord[],
  eventTypes: Set<string>,
): boolean {
  return events.some((event) => eventTypes.has(event.eventType));
}

function hasSourceStage(
  events: readonly ActionLogRecord[],
  stage: ActionLogSourceStage,
): boolean {
  return events.some((event) => event.sourceStage === stage);
}

function isMlFallbackPath(events: readonly ActionLogRecord[]): boolean {
  return events.some(
    (event) =>
      event.eventType === 'ML_SKIPPED' || event.eventType === 'ML_FAILED_SAFE',
  );
}

function correlationIds(events: readonly ActionLogRecord[]): Set<string> {
  return new Set(events.map((event) => event.correlationId));
}

function collectStagesPresent(
  events: readonly ActionLogRecord[],
): ActionLogSourceStage[] {
  return [...new Set(events.map((event) => event.sourceStage))];
}

export interface CompletenessEvaluation {
  completeness: ProvenanceCompleteness;
  reasonCodes: ProvenanceReasonCode[];
  stagesPresent: ActionLogSourceStage[];
  stagesMissing: string[];
}

function isRollbackAdvisoryPath(events: readonly ActionLogRecord[]): boolean {
  return (
    events.some((event) => event.eventType === 'EXECUTION_FAILED') &&
    hasEventType(events, VERIFICATION_EVENT_TYPES)
  );
}

export function evaluateProvenanceCompleteness(
  events: readonly ActionLogRecord[],
  sourceReferences: readonly ProvenanceSourceReference[],
  options?: { sourceVerificationMode?: SourceVerificationMode },
): CompletenessEvaluation {
  const sourceVerificationMode =
    options?.sourceVerificationMode ?? 'source_verified';
  const reasonCodes: ProvenanceReasonCode[] = [];
  const stagesPresent = collectStagesPresent(events);
  const stagesMissing: string[] = [];

  const correlationSet = correlationIds(events);
  if (correlationSet.size > 1) {
    reasonCodes.push(PROVENANCE_REASON.PROVENANCE_CORRELATION_GAP);
  }

  if (isSimulationPath(events)) {
    reasonCodes.push(PROVENANCE_REASON.PROVENANCE_SIMULATION_PATH);
  }

  if (isMlFallbackPath(events)) {
    reasonCodes.push(PROVENANCE_REASON.PROVENANCE_ML_PATH_VALID);
  }

  if (requiresApproval(events)) {
    const approvalRequired = events.some(
      (event) => event.eventType === 'APPROVAL_REQUIRED',
    );
    const approvalResolved = hasEventType(events, APPROVAL_RESOLUTION_EVENT_TYPES);
    if (approvalRequired && !approvalResolved) {
      stagesMissing.push('APPROVAL');
      reasonCodes.push(PROVENANCE_REASON.PROVENANCE_APPROVAL_MISSING);
    }
  }

  if (requiresExecution(events) && !hasEventType(events, EXECUTION_EVENT_TYPES)) {
    stagesMissing.push('EXECUTION');
    reasonCodes.push(PROVENANCE_REASON.PROVENANCE_EXECUTION_MISSING);
  }

  if (requiresVerification(events) && !hasEventType(events, VERIFICATION_EVENT_TYPES)) {
    stagesMissing.push('VERIFICATION');
    reasonCodes.push(PROVENANCE_REASON.PROVENANCE_VERIFICATION_MISSING);
  }

  if (isRollbackAdvisoryPath(events)) {
    reasonCodes.push(PROVENANCE_REASON.PROVENANCE_ROLLBACK_MISSING);
  }

  if (sourceVerificationMode === 'source_verified') {
    const unverifiedRequiredSources = sourceReferences.filter(
      (reference) =>
        isRequiredReferenceOnlySource(reference, events) &&
        reference.availability === 'NOT_RESOLVED',
    );
    if (unverifiedRequiredSources.length > 0) {
      reasonCodes.push(PROVENANCE_REASON.PROVENANCE_SOURCE_RECORD_NOT_VERIFIED);
    }

    const unavailableRequiredSources = sourceReferences.filter(
      (reference) =>
        isRequiredReferenceOnlySource(reference, events) &&
        reference.availability === 'UNAVAILABLE',
    );
    if (unavailableRequiredSources.length > 0) {
      reasonCodes.push(PROVENANCE_REASON.PROVENANCE_SOURCE_RECORD_UNAVAILABLE);
    }
  }

  const hasRecommendation = hasSourceStage(events, 'RECOMMENDATION');
  const hasCostEvidence = events.some(
    (event) =>
      event.sourceStage === 'RECOMMENDATION' &&
      event.reasonCodes?.some((code) => code.includes('COST')),
  );
  if (hasRecommendation && !hasCostEvidence && requiresExecution(events)) {
    reasonCodes.push(PROVENANCE_REASON.PROVENANCE_OPTIONAL_COST_EVIDENCE_MISSING);
  }

  const expectsLearningOutcome = hasSourceStage(events, 'DECISION_READINESS');
  const hasLearningOutcome = events.some(
    (event) => event.eventType === 'RECOMMENDATION_DECIDED',
  );
  if (expectsLearningOutcome && !hasLearningOutcome && requiresExecution(events)) {
    reasonCodes.push(PROVENANCE_REASON.PROVENANCE_OPTIONAL_LEARNING_MISSING);
  }

  const incompleteReasons: ProvenanceReasonCode[] = [
    PROVENANCE_REASON.PROVENANCE_APPROVAL_MISSING,
    PROVENANCE_REASON.PROVENANCE_EXECUTION_MISSING,
    PROVENANCE_REASON.PROVENANCE_VERIFICATION_MISSING,
    PROVENANCE_REASON.PROVENANCE_CORRELATION_GAP,
  ];
  const partialReasons: ProvenanceReasonCode[] = [
    PROVENANCE_REASON.PROVENANCE_SOURCE_RECORD_UNAVAILABLE,
    PROVENANCE_REASON.PROVENANCE_SOURCE_RECORD_NOT_VERIFIED,
    PROVENANCE_REASON.PROVENANCE_OPTIONAL_COST_EVIDENCE_MISSING,
    PROVENANCE_REASON.PROVENANCE_OPTIONAL_LEARNING_MISSING,
    PROVENANCE_REASON.PROVENANCE_ROLLBACK_MISSING,
  ];

  const hasIncompleteReason = reasonCodes.some((code) =>
    incompleteReasons.includes(code),
  );

  const hasPartialReason = reasonCodes.some((code) =>
    partialReasons.includes(code),
  );

  let completeness: ProvenanceCompleteness;
  if (hasIncompleteReason) {
    completeness = 'INCOMPLETE';
  } else if (hasPartialReason) {
    completeness = 'PARTIAL';
  } else {
    completeness = 'COMPLETE';
    reasonCodes.push(PROVENANCE_REASON.PROVENANCE_COMPLETE);
  }

  return {
    completeness,
    reasonCodes: [...new Set(reasonCodes)],
    stagesPresent,
    stagesMissing,
  };
}
