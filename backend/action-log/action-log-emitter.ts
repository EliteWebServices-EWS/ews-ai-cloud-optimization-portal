import { ActionLogPersistenceError } from './errors';
import type { ActionLogLifecycleContext } from './lifecycle-context';
import {
  buildConfidenceEvaluatedEventInput,
  buildDecisionReadinessEvaluatedEventInput,
  buildGovernanceEvaluatedEventInput,
  buildMaturityEvaluatedEventInput,
  buildPersistenceEvaluatedEventInput,
  buildRecommendationObservedEventInput,
  buildApprovalRequiredEventInput,
  buildApprovalGrantedEventInput,
  buildApprovalRejectedEventInput,
  buildApprovalOverriddenEventInput,
  buildExecutionStartedEventInput,
  buildExecutionSimulatedEventInput,
  type ActionLogResourceScope,
} from './stage-adapters';
import type {
  RecordActionLogEventInput,
  RecordActionLogEventResult,
} from './types';
import type { Sprint2DecisionReadinessResult } from '../decision-readiness/types';
import type { EvidenceMaturityAssessmentRecord } from '../evidence-maturity/types';
import type { GovernanceConvergenceResultRecord } from '../governance-convergence/types';
import type { RecordEvidenceObservationResult } from '../persistence-intelligence/types';
import type { ActionLogService } from '../services/action-log-service';
import { ActionLogValidationError } from './types';

/**
 * Records already-computed stage outputs into ActionLog.
 * Contains no intelligence/policy recomputation.
 */
export class ActionLogEmitter {
  constructor(private readonly service: ActionLogService) {}

  async emit(input: RecordActionLogEventInput): Promise<RecordActionLogEventResult> {
    try {
      return await this.service.recordEvent(input);
    } catch (error) {
      if (error instanceof ActionLogValidationError) {
        throw error;
      }
      throw new ActionLogPersistenceError('ActionLog persistence failed.', { cause: error });
    }
  }

  async emitAfterEvidenceObservation(input: {
    result: RecordEvidenceObservationResult;
    context: ActionLogLifecycleContext;
  }): Promise<RecordActionLogEventResult[]> {
    this.assertContextMatchesObservation(input.result.observation.tenantId, input.result.observation.accountId, input.context);
    const recommendation = await this.emit(
      buildRecommendationObservedEventInput({
        observation: input.result.observation,
        context: input.context,
      }),
    );
    const persistence = await this.emit(
      buildPersistenceEvaluatedEventInput({
        result: input.result,
        context: input.context,
      }),
    );
    return [recommendation, persistence];
  }

  async emitAfterMaturityAssessment(input: {
    assessment: EvidenceMaturityAssessmentRecord;
    context: ActionLogLifecycleContext;
  }): Promise<RecordActionLogEventResult> {
    this.assertScope(
      input.assessment.tenantId,
      input.assessment.accountId,
      input.context,
    );
    return this.emit(
      buildMaturityEvaluatedEventInput({
        assessment: input.assessment,
        context: input.context,
      }),
    );
  }

  async emitAfterGovernanceResult(input: {
    result: GovernanceConvergenceResultRecord;
    context: ActionLogLifecycleContext;
  }): Promise<RecordActionLogEventResult> {
    this.assertScope(input.result.tenantId, input.result.accountId, input.context);
    return this.emit(
      buildGovernanceEvaluatedEventInput({
        result: input.result,
        context: input.context,
      }),
    );
  }

  async emitAfterDecisionReadinessAssessment(input: {
    readiness: Sprint2DecisionReadinessResult;
    scope: ActionLogResourceScope;
    context: ActionLogLifecycleContext;
  }): Promise<RecordActionLogEventResult[]> {
    this.assertScope(input.scope.tenantId, input.scope.accountId, input.context);
    const confidence = await this.emit(
      buildConfidenceEvaluatedEventInput(input),
    );
    const readiness = await this.emit(
      buildDecisionReadinessEvaluatedEventInput(input),
    );
    return [confidence, readiness];
  }

  async emitAfterApprovalRequired(input: {
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
    context: ActionLogLifecycleContext;
  }): Promise<RecordActionLogEventResult> {
    this.assertScope(input.tenantId, input.accountId, input.context);
    return this.emit(
      buildApprovalRequiredEventInput(input),
    );
  }

  async emitAfterApprovalGranted(input: {
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
    context: ActionLogLifecycleContext;
  }): Promise<RecordActionLogEventResult> {
    this.assertScope(input.tenantId, input.accountId, input.context);
    return this.emit(
      buildApprovalGrantedEventInput(input),
    );
  }

  async emitAfterApprovalRejected(input: {
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
    context: ActionLogLifecycleContext;
  }): Promise<RecordActionLogEventResult> {
    this.assertScope(input.tenantId, input.accountId, input.context);
    return this.emit(
      buildApprovalRejectedEventInput(input),
    );
  }

  async emitAfterApprovalOverridden(input: {
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
    context: ActionLogLifecycleContext;
  }): Promise<RecordActionLogEventResult> {
    this.assertScope(input.tenantId, input.accountId, input.context);
    return this.emit(
      buildApprovalOverriddenEventInput(input),
    );
  }
  async emitAfterExecutionStarted(input: {
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
    context: ActionLogLifecycleContext;
  }): Promise<RecordActionLogEventResult> {
    this.assertScope(input.tenantId, input.accountId, input.context);
    return this.emit(
      buildExecutionStartedEventInput(input),
    );
  }

  async emitAfterExecutionSimulated(input: {
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
    context: ActionLogLifecycleContext;
  }): Promise<RecordActionLogEventResult> {
    this.assertScope(input.tenantId, input.accountId, input.context);
    return this.emit(
      buildExecutionSimulatedEventInput(input),
    );
  }

  private assertContextMatchesObservation(
    tenantId: string,
    accountId: string,
    context: ActionLogLifecycleContext,
  ): void {
    this.assertScope(tenantId, accountId, context);
  }

  private assertScope(
    tenantId: string,
    accountId: string,
    context: ActionLogLifecycleContext,
  ): void {
    if (!tenantId.trim() || !accountId.trim()) {
      throw new ActionLogValidationError('ActionLog emitter requires explicit tenant and account scope.');
    }
    if (tenantId !== context.tenantId) {
      throw new ActionLogValidationError(
        'ActionLog emitter tenant scope does not match lifecycle context tenantId.',
      );
    }
    if (accountId !== context.accountId) {
      throw new ActionLogValidationError(
        'ActionLog emitter account scope does not match lifecycle context accountId.',
      );
    }
  }
}
