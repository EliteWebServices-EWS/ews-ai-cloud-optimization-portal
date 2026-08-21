import type { Sprint2DecisionReadinessResult } from '../decision-readiness/types';
import type { EvidenceMaturityAssessmentRecord } from '../evidence-maturity/types';
import type { GovernanceConvergenceResultRecord } from '../governance-convergence/types';
import type {
  EvidenceObservationRecord,
  RecordEvidenceObservationResult,
} from '../persistence-intelligence/types';
import {
  resolveActionLogDecisionId,
  type ActionLogLifecycleContext,
} from './lifecycle-context';
import type { RecordActionLogEventInput } from './types';

export interface ActionLogResourceScope {
  tenantId: string;
  accountId: string;
  resourceId: string;
}

function baseScopeFromObservation(
  observation: EvidenceObservationRecord,
  context: ActionLogLifecycleContext,
): Pick<
  RecordActionLogEventInput,
  | 'tenantId'
  | 'accountId'
  | 'resourceId'
  | 'findingKey'
  | 'correlationId'
  | 'decisionId'
  | 'workflowId'
  | 'jobId'
> {
  return {
    tenantId: observation.tenantId,
    accountId: observation.accountId,
    resourceId: observation.resourceId,
    findingKey: observation.findingKey,
    correlationId: context.correlationId,
    decisionId: resolveActionLogDecisionId({
      correlationId: context.correlationId,
      findingKey: observation.findingKey,
      recommendationId: context.recommendationId,
      decisionId: context.decisionId,
    }),
    workflowId: context.workflowId,
    jobId: context.jobId ?? observation.jobId,
  };
}

export function buildRecommendationObservedEventInput(input: {
  observation: EvidenceObservationRecord;
  context: ActionLogLifecycleContext;
}): RecordActionLogEventInput {
  const { observation, context } = input;
  return {
    ...baseScopeFromObservation(observation, context),
    eventType: 'RECOMMENDATION_OBSERVED',
    sourceStage: 'RECOMMENDATION',
    sourceRecordId: observation.observationId,
    sourceRecordVersion: String(observation.version),
    occurredAt: observation.observationTimestamp,
    reasonCodes: [observation.category],
  };
}

export function buildPersistenceEvaluatedEventInput(input: {
  result: RecordEvidenceObservationResult;
  context: ActionLogLifecycleContext;
}): RecordActionLogEventInput {
  const observation = input.result.observation;
  const assessment = input.result.assessment;
  return {
    ...baseScopeFromObservation(observation, input.context),
    eventType: 'PERSISTENCE_EVALUATED',
    sourceStage: 'PERSISTENCE',
    sourceRecordId: observation.logicalObservationId,
    sourceRecordVersion: observation.ruleVersion,
    occurredAt: observation.observationTimestamp,
    reasonCodes: [assessment.state, ...assessment.reasonCodes],
  };
}

export function buildMaturityEvaluatedEventInput(input: {
  assessment: EvidenceMaturityAssessmentRecord;
  context: ActionLogLifecycleContext;
}): RecordActionLogEventInput {
  const record = input.assessment;
  return {
    tenantId: record.tenantId,
    accountId: record.accountId,
    resourceId: record.resourceId,
    findingKey: record.findingKey,
    correlationId: input.context.correlationId,
    decisionId: resolveActionLogDecisionId({
      correlationId: input.context.correlationId,
      findingKey: record.findingKey,
      recommendationId: input.context.recommendationId,
      decisionId: input.context.decisionId,
    }),
    workflowId: input.context.workflowId,
    jobId: input.context.jobId,
    eventType: 'MATURITY_EVALUATED',
    sourceStage: 'MATURITY',
    sourceRecordId: record.assessmentId,
    sourceRecordVersion: record.modelVersion,
    occurredAt: record.evaluatedAt,
    reasonCodes: [record.maturity, ...record.reasonCodes],
  };
}

export function buildGovernanceEvaluatedEventInput(input: {
  result: GovernanceConvergenceResultRecord;
  context: ActionLogLifecycleContext;
}): RecordActionLogEventInput {
  const record = input.result;
  return {
    tenantId: record.tenantId,
    accountId: record.accountId,
    resourceId: record.resourceId,
    findingKey: record.findingKey,
    correlationId: input.context.correlationId,
    decisionId: resolveActionLogDecisionId({
      correlationId: input.context.correlationId,
      findingKey: record.findingKey,
      recommendationId: input.context.recommendationId,
      decisionId: input.context.decisionId,
    }),
    workflowId: input.context.workflowId,
    jobId: input.context.jobId,
    eventType: 'GOVERNANCE_EVALUATED',
    sourceStage: 'GOVERNANCE',
    sourceRecordId: record.resultId,
    sourceRecordVersion: record.ruleVersion,
    occurredAt: record.evaluatedAt,
    reasonCodes: [record.state, ...record.reasonCodes],
  };
}

export function buildConfidenceEvaluatedEventInput(input: {
  readiness: Sprint2DecisionReadinessResult;
  scope: ActionLogResourceScope;
  context: ActionLogLifecycleContext;
}): RecordActionLogEventInput {
  const readiness = input.readiness;
  return {
    tenantId: input.scope.tenantId,
    accountId: input.scope.accountId,
    resourceId: input.scope.resourceId,
    findingKey: readiness.findingKey,
    correlationId: input.context.correlationId,
    decisionId: resolveActionLogDecisionId({
      correlationId: input.context.correlationId,
      findingKey: readiness.findingKey,
      recommendationId: readiness.recommendationId,
      decisionId: input.context.decisionId,
    }),
    workflowId: input.context.workflowId,
    jobId: input.context.jobId,
    eventType: 'CONFIDENCE_EVALUATED',
    sourceStage: 'CONFIDENCE',
    sourceRecordId: `${readiness.recommendationId}#confidence`,
    sourceRecordVersion: readiness.confidence.formulaVersion,
    occurredAt: readiness.evaluatedAt,
    reasonCodes: [readiness.confidence.status, ...readiness.confidence.reasonCodes],
  };
}

export function buildDecisionReadinessEvaluatedEventInput(input: {
  readiness: Sprint2DecisionReadinessResult;
  scope: ActionLogResourceScope;
  context: ActionLogLifecycleContext;
}): RecordActionLogEventInput {
  const readiness = input.readiness;
  return {
    tenantId: input.scope.tenantId,
    accountId: input.scope.accountId,
    resourceId: input.scope.resourceId,
    findingKey: readiness.findingKey,
    correlationId: input.context.correlationId,
    decisionId: resolveActionLogDecisionId({
      correlationId: input.context.correlationId,
      findingKey: readiness.findingKey,
      recommendationId: readiness.recommendationId,
      decisionId: input.context.decisionId,
    }),
    workflowId: input.context.workflowId,
    jobId: input.context.jobId,
    eventType: 'DECISION_READINESS_EVALUATED',
    sourceStage: 'DECISION_READINESS',
    sourceRecordId: readiness.recommendationId,
    sourceRecordVersion: readiness.policyVersion,
    occurredAt: readiness.evaluatedAt,
    reasonCodes: [readiness.readiness, ...readiness.reasonCodes],
  };
}

function buildApprovalScope(input: {
  tenantId: string;
  accountId: string;
  resourceId?: string;
  findingKey?: string;
  correlationId: string;
  recommendationId: string;
  decisionId?: string;
  workflowId?: string;
  executionId: string;
}): Pick<
  RecordActionLogEventInput,
  | 'tenantId'
  | 'accountId'
  | 'resourceId'
  | 'findingKey'
  | 'correlationId'
  | 'decisionId'
  | 'workflowId'
  | 'executionId'
> {
  return {
    tenantId: input.tenantId,
    accountId: input.accountId,
    resourceId: input.resourceId,
    findingKey: input.findingKey,
    correlationId: input.correlationId,
    decisionId: resolveActionLogDecisionId({
      correlationId: input.correlationId,
      findingKey: input.findingKey ?? input.recommendationId,
      recommendationId: input.recommendationId,
      decisionId: input.decisionId,
    }),
    workflowId: input.workflowId,
    executionId: input.executionId,
  };
}

export function buildApprovalRequiredEventInput(input: {
  tenantId: string;
  accountId: string;
  resourceId?: string;
  findingKey?: string;
  correlationId: string;
  recommendationId: string;
  decisionId?: string;
  workflowId?: string;
  executionId: string;
  planVersion: number;
  policyVersion: string;
  occurredAt: string;
  reasonCodes?: readonly string[];
}): RecordActionLogEventInput {
  return {
    ...buildApprovalScope(input),
    eventType: 'APPROVAL_REQUIRED',
    sourceStage: 'APPROVAL',
    sourceRecordId: input.executionId,
    sourceRecordVersion: String(input.planVersion),
    occurredAt: input.occurredAt,
    reasonCodes: input.reasonCodes,
  };
}

export function buildApprovalGrantedEventInput(input: {
  tenantId: string;
  accountId: string;
  resourceId?: string;
  findingKey?: string;
  correlationId: string;
  recommendationId: string;
  decisionId?: string;
  workflowId?: string;
  executionId: string;
  planVersion: number;
  policyVersion: string;
  occurredAt: string;
  actorId: string;
  reasonCodes?: readonly string[];
}): RecordActionLogEventInput {
  return {
    ...buildApprovalScope(input),
    eventType: 'APPROVAL_GRANTED',
    sourceStage: 'APPROVAL',
    sourceRecordId: input.executionId,
    sourceRecordVersion: String(input.planVersion),
    occurredAt: input.occurredAt,
    reasonCodes: input.reasonCodes,
    actorType: 'human',
    actorId: input.actorId,
  };
}

export function buildApprovalRejectedEventInput(input: {
  tenantId: string;
  accountId: string;
  resourceId?: string;
  findingKey?: string;
  correlationId: string;
  recommendationId: string;
  decisionId?: string;
  workflowId?: string;
  executionId: string;
  planVersion: number;
  policyVersion: string;
  occurredAt: string;
  actorId: string;
  reasonCodes?: readonly string[];
}): RecordActionLogEventInput {
  return {
    ...buildApprovalScope(input),
    eventType: 'APPROVAL_REJECTED',
    sourceStage: 'APPROVAL',
    sourceRecordId: input.executionId,
    sourceRecordVersion: String(input.planVersion),
    occurredAt: input.occurredAt,
    reasonCodes: input.reasonCodes,
    actorType: 'human',
    actorId: input.actorId,
  };
}

export function buildApprovalOverriddenEventInput(input: {
  tenantId: string;
  accountId: string;
  resourceId?: string;
  findingKey?: string;
  correlationId: string;
  recommendationId: string;
  decisionId?: string;
  workflowId?: string;
  executionId: string;
  planVersion: number;
  policyVersion: string;
  occurredAt: string;
  actorId: string;
  reasonCodes?: readonly string[];
}): RecordActionLogEventInput {
  return {
    ...buildApprovalScope(input),
    eventType: 'APPROVAL_OVERRIDDEN',
    sourceStage: 'APPROVAL',
    sourceRecordId: input.executionId,
    sourceRecordVersion: String(input.planVersion),
    occurredAt: input.occurredAt,
    reasonCodes: input.reasonCodes,
    actorType: 'human',
    actorId: input.actorId,
  };
}
export function buildExecutionStartedEventInput(input: {
  tenantId: string;
  accountId: string;
  resourceId?: string;
  findingKey?: string;
  correlationId: string;
  recommendationId: string;
  decisionId?: string;
  workflowId?: string;
  executionId: string;
  runId?: string;
  planVersion: number;
  occurredAt: string;
  reasonCodes?: readonly string[];
  actorId: string;
}): RecordActionLogEventInput {
  return {
    ...buildApprovalScope(input),
    eventType: 'EXECUTION_STARTED',
    sourceStage: 'EXECUTION',
    sourceRecordId: input.runId ?? input.executionId,
    sourceRecordVersion: String(input.planVersion),
    occurredAt: input.occurredAt,
    reasonCodes: input.reasonCodes,
    actorType: 'human',
    actorId: input.actorId,
  };
}

export function buildExecutionSimulatedEventInput(input: {
  tenantId: string;
  accountId: string;
  resourceId?: string;
  findingKey?: string;
  correlationId: string;
  recommendationId: string;
  decisionId?: string;
  workflowId?: string;
  executionId: string;
  planVersion: number;
  occurredAt: string;
  reasonCodes?: readonly string[];
  actorId: string;
}): RecordActionLogEventInput {
  return {
    ...buildApprovalScope(input),
    eventType: 'EXECUTION_SIMULATED',
    sourceStage: 'EXECUTION',
    sourceRecordId: input.executionId,
    sourceRecordVersion: String(input.planVersion),
    occurredAt: input.occurredAt,
    reasonCodes: input.reasonCodes,
    actorType: 'human',
    actorId: input.actorId,
  };
}
