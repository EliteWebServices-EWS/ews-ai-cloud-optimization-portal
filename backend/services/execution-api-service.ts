import type { ExecutionOrchestrator } from '../execution/execution-orchestrator';
import { EXECUTION_MODES, ExecutionAdapterError } from '../execution/adapters/types';
import type { AdapterExecutionRequest } from '../execution/adapters/types';
import type { ActionLogEmitter } from '../action-log/action-log-emitter';
import type { ActionLogLifecycleContext } from '../action-log/lifecycle-context';
import {
  assertPolicyAllowsPlanCreation,
  assertProductionExecutionEligible,
  assertSimulationExecutionEligible,
  buildPolicyMetadata,
  deriveApprovalRequiredFromPolicy,
  evaluateActionPolicy,
  readPolicyProvenance,
  readPolicySnapshot,
  appendOverrideHistory,
  EXECUTION_PLAN_METADATA_APPROVAL_ACTOR_ROLE,
  EXECUTION_PLAN_METADATA_APPROVAL_REASON,
  ACTION_POLICY_REASON,
  type ExecutionPlanOverrideEntry,
} from '../action-policy';
import {
  RepositoryConflictError,
  RepositoryNotFoundError,
} from '../database';
import type {
  ExecutionHistoryRepository,
  ExecutionPlanRepository,
  ExecutionRunRepository,
} from '../repositories/contracts';
import { initialApprovalStatus } from '../repositories/contracts/execution-plan-repository';
import type {
  ExecutionPlanRecord,
  ExecutionPlanStatus,
} from '../repositories/models/execution-persistence-models';
import type { ExecutionRunRecord, AdapterExecutionStatus } from '../repositories/models/execution-run-models';
import {
  InvalidExecutionApprovalError,
  InvalidExecutionOverrideError,
  InvalidExecutionTransitionError,
  validateExecutionStartAllowed,
} from '../services/execution-lifecycle';
import { isAdapterProductionExecutionEnabled } from '../services/execution-production-config';
import { AppError, generateExecutionId } from '../shared/utils';
import type {
  CreateExecutionPlanBody,
  ExecutionPlanListQuery,
  UpdateExecutionPlanBody,
} from '../api/execution-api-validation';

export const EXECUTION_PLAN_METADATA_RUN_ID = 'lastRunId';
export const EXECUTION_PLAN_METADATA_REGION = 'executionRegion';

export interface ExecutionApiServiceDeps {
  plans: ExecutionPlanRepository;
  runs: ExecutionRunRepository;
  history: ExecutionHistoryRepository;
  orchestrator: ExecutionOrchestrator;
  actionLogEmitter?: ActionLogEmitter;
}

export interface ExecutionApiActorContext {
  tenantId: string;
  actorId: string;
  actor: import('../audit').AuditActor;
  requestId: string;
  correlationId: string;
}

export interface RollbackPlanOutcome {
  plan: ExecutionPlanRecord;
  run: ExecutionRunRecord | undefined;
  result: import('../execution/adapters/types').OrchestratedExecutionResult;
  rollbackRequested: boolean;
}

const RUN_STATUSES_ROLLBACK_START: readonly AdapterExecutionStatus[] = [
  'SUCCEEDED',
  'FAILED',
  'ROLLBACK_FAILED',
];

function assertRollbackLifecycle(
  plan: ExecutionPlanRecord,
  run: ExecutionRunRecord,
): void {
  if (plan.planStatus === 'ROLLED_BACK') {
    throw new AppError(
      'CONFLICT',
      'Execution plan was already rolled back.',
      409,
      'execution-api',
    );
  }

  if (!['COMPLETED', 'FAILED', 'EXECUTING'].includes(plan.planStatus)) {
    throw new AppError(
      'CONFLICT',
      'Plan is not eligible for rollback.',
      409,
      'execution-api',
    );
  }

  if (run.status === 'ROLLED_BACK') {
    throw new AppError(
      'CONFLICT',
      'Execution run was already rolled back.',
      409,
      'execution-api',
    );
  }

  if (run.status === 'ROLLBACK_PENDING') {
    throw new AppError(
      'CONFLICT',
      'Rollback is already in progress for this execution run.',
      409,
      'execution-api',
    );
  }

  if (!RUN_STATUSES_ROLLBACK_START.includes(run.status)) {
    throw new AppError(
      'CONFLICT',
      `Execution run cannot be rolled back from status ${run.status}.`,
      409,
      'execution-api',
    );
  }

  if (!run.rollbackState.eligible) {
    throw new AppError(
      'CONFLICT',
      run.rollbackState.reason ?? 'Rollback is not eligible for this execution run.',
      409,
      'execution-api',
    );
  }
}

async function revertRunRollbackClaim(
  deps: ExecutionApiServiceDeps,
  tenantId: string,
  runId: string,
  restoreStatus: AdapterExecutionStatus,
): Promise<void> {
  const current = await deps.runs.getById(tenantId, runId);
  if (!current || current.status !== 'ROLLBACK_PENDING') {
    return;
  }

  await deps.runs.update(
    tenantId,
    runId,
    { status: restoreStatus },
    { expectedVersion: current.version },
  );
}

function sortedSteps(plan: ExecutionPlanRecord) {
  return [...plan.executionSteps].sort((left, right) => left.order - right.order);
}

function mapResourceTypeToService(resourceType: string): AdapterExecutionRequest['service'] {
  const normalized = resourceType.trim().toLowerCase();
  switch (normalized) {
    case 'ec2':
      return 'ec2';
    case 's3':
      return 's3';
    case 'rds':
      return 'rds';
    case 'lambda':
      return 'lambda';
    case 'cloudfront':
      return 'cloudfront';
    case 'autoscaling':
    case 'auto_scaling':
      return 'autoscaling';
    default:
      throw new AppError(
        'UNSUPPORTED_RESOURCE',
        `Unsupported resource type: ${resourceType}.`,
        422,
        'execution-api',
      );
  }
}

function buildAdapterRequest(plan: ExecutionPlanRecord): AdapterExecutionRequest {
  const step = sortedSteps(plan)[0];
  if (!step) {
    throw new AppError(
      'INVALID_PLAN',
      'Execution plan has no steps.',
      422,
      'execution-api',
    );
  }

  return {
    service: mapResourceTypeToService(step.resourceType),
    action: step.actionType.trim().toUpperCase(),
    resourceId: step.resourceId,
    parameters: step.parameters,
  };
}

function resolveRegion(plan: ExecutionPlanRecord, override?: string): string {
  const fromMetadata =
    typeof plan.metadata?.[EXECUTION_PLAN_METADATA_REGION] === 'string'
      ? String(plan.metadata[EXECUTION_PLAN_METADATA_REGION])
      : undefined;
  return override ?? fromMetadata ?? 'us-east-1';
}

function buildActionLogContext(
  plan: ExecutionPlanRecord,
  ctx: ExecutionApiActorContext,
): ActionLogLifecycleContext | undefined {
  const provenance = readPolicyProvenance(plan.metadata);
  if (!provenance?.accountId || !provenance.correlationId) {
    return undefined;
  }

  return {
    tenantId: ctx.tenantId,
    accountId: provenance.accountId,
    correlationId: provenance.correlationId,
    recommendationId: plan.recommendationId,
    decisionId: provenance.decisionId,
    workflowId: plan.workflowId,
  };
}

function actionLogScopeFromPlan(
  plan: ExecutionPlanRecord,
  ctx: ExecutionApiActorContext,
) {
  const provenance = readPolicyProvenance(plan.metadata);
  const context = buildActionLogContext(plan, ctx);
  const snapshot = readPolicySnapshot(plan.metadata);
  if (!provenance?.accountId || !provenance.correlationId || !context) {
    return undefined;
  }

  return {
    tenantId: ctx.tenantId,
    accountId: provenance.accountId,
    resourceId: provenance.resourceId,
    findingKey: provenance.findingKey,
    correlationId: provenance.correlationId,
    recommendationId: plan.recommendationId,
    decisionId: provenance.decisionId,
    workflowId: plan.workflowId,
    executionId: plan.executionId,
    planVersion: plan.version,
    policyVersion:
      snapshot?.policyVersion ??
      provenance.actionPolicyVersion ??
      'action-policy-v1',
    context,
  };
}

async function emitActionLogSafely(
  emitter: ActionLogEmitter | undefined,
  operation: () => Promise<unknown>,
): Promise<void> {
  if (!emitter) {
    return;
  }

  try {
    await operation();
  } catch (error) {
    throw new AppError(
      'ACTION_LOG_PERSISTENCE_FAILED',
      error instanceof Error ? error.message : 'ActionLog persistence failed.',
      500,
      'action-log',
    );
  }
}

export function sanitizeExecutionPlan(plan: ExecutionPlanRecord) {
  return {
    planId: plan.executionId,
    tenantId: plan.tenantId,
    workflowId: plan.workflowId,
    recommendationId: plan.recommendationId,
    planStatus: plan.planStatus,
    approvalRequired: plan.approvalRequired,
    approvalStatus: plan.approvalStatus,
    approvedBy: plan.approvedBy,
    approvedAt: plan.approvedAt,
    rejectedBy: plan.rejectedBy,
    rejectedAt: plan.rejectedAt,
    rejectionReason: plan.rejectionReason,
    riskLevel: plan.riskLevel,
    executionSteps: plan.executionSteps,
    rollbackPlan: plan.rollbackPlan,
    metadata: plan.metadata,
    version: plan.version,
    createdBy: plan.createdBy,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export function sanitizeExecutionRun(run: ExecutionRunRecord) {
  return {
    runId: run.runId,
    tenantId: run.tenantId,
    workflowId: run.workflowId,
    mode: run.mode,
    service: run.service,
    action: run.action,
    resourceId: run.resourceId,
    region: run.region,
    status: run.status,
    rollbackEligible: run.rollbackState.eligible,
    failureCode: run.failure?.code,
    failureMessage: run.failure?.message,
    rollbackFailureCode: run.rollbackFailure?.code,
    version: run.version,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

async function appendHistory(
  deps: ExecutionApiServiceDeps,
  input: {
    tenantId: string;
    executionId: string;
    workflowId: string;
    actorId: string;
    eventType: import('../repositories/models/execution-persistence-models').ExecutionHistoryEventType;
    previousStatus?: ExecutionPlanStatus;
    nextStatus?: ExecutionPlanStatus;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await deps.history.append({
    historyId: `${generateExecutionId()}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    tenantId: input.tenantId,
    executionId: input.executionId,
    workflowId: input.workflowId,
    eventType: input.eventType,
    previousStatus: input.previousStatus,
    nextStatus: input.nextStatus,
    actorId: input.actorId,
    createdAt: new Date().toISOString(),
    details: input.details,
  });
}

function assertMutablePlan(plan: ExecutionPlanRecord): void {
  if (!['DRAFT', 'PENDING_APPROVAL'].includes(plan.planStatus)) {
    throw new AppError(
      'CONFLICT',
      'Only draft or pending-approval plans may be updated.',
      409,
      'execution-api',
    );
  }
}

export class ExecutionApiService {
  constructor(private readonly deps: ExecutionApiServiceDeps) {}

  async createPlan(
    ctx: ExecutionApiActorContext,
    body: CreateExecutionPlanBody,
  ): Promise<ExecutionPlanRecord> {
    const executionId = generateExecutionId();
    let approvalRequired = body.approvalRequired;
    let policyMetadata: Record<string, unknown> = {};

    if (body.policyContext) {
      const evaluatedAt = new Date().toISOString();
      const policy = evaluateActionPolicy({
        evaluatedAt,
        decisionReadiness: body.policyContext.decisionReadiness,
        mlDecisionSummary: body.policyContext.mlDecisionSummary,
        actionMode: body.policyContext.actionMode,
        infrastructureChanging: body.policyContext.infrastructureChanging,
      });
      assertPolicyAllowsPlanCreation(policy);
      approvalRequired = deriveApprovalRequiredFromPolicy(policy);
      policyMetadata = buildPolicyMetadata({
        accountId: body.policyContext.accountId,
        correlationId: ctx.correlationId,
        decisionId: body.policyContext.decisionId,
        findingKey: body.policyContext.findingKey,
        resourceId: body.policyContext.resourceId,
        actionPolicyVersion: policy.policyVersion,
        actionPolicySnapshot: policy,
        actionMode: policy.actionMode,
      });
    }

    const metadata = {
      ...(body.metadata ?? {}),
      ...policyMetadata,
      ...(body.region ? { [EXECUTION_PLAN_METADATA_REGION]: body.region } : {}),
    };

    const created = await this.deps.plans.create({
      executionId,
      tenantId: ctx.tenantId,
      workflowId: body.workflowId,
      recommendationId: body.recommendationId,
      planStatus: 'DRAFT',
      createdBy: ctx.actorId,
      executionSteps: body.executionSteps,
      rollbackPlan: body.rollbackPlan,
      riskLevel: body.riskLevel,
      approvalRequired,
      approvalStatus: initialApprovalStatus(approvalRequired),
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });

    await appendHistory(this.deps, {
      tenantId: ctx.tenantId,
      executionId: created.executionId,
      workflowId: created.workflowId,
      actorId: ctx.actorId,
      eventType: 'PLAN_CREATED',
      nextStatus: created.planStatus,
    });

    return created;
  }

  async getPlan(tenantId: string, planId: string): Promise<ExecutionPlanRecord | undefined> {
    return this.deps.plans.getById(tenantId, planId);
  }

  async updatePlan(
    ctx: ExecutionApiActorContext,
    planId: string,
    body: UpdateExecutionPlanBody,
  ): Promise<ExecutionPlanRecord> {
    const existing = await this.requirePlan(ctx.tenantId, planId);
    assertMutablePlan(existing);

    let current = existing;

    if (body.submitForApproval) {
      if (!existing.approvalRequired) {
        throw new AppError(
          'CONFLICT',
          'Plan does not require approval submission.',
          409,
          'execution-api',
        );
      }
      current = await this.deps.plans.transitionStatus(
        ctx.tenantId,
        planId,
        'PENDING_APPROVAL',
        { expectedVersion: body.expectedVersion },
      );
    }

    const changes: Parameters<ExecutionPlanRepository['update']>[2] = {};
    if (body.metadata !== undefined) {
      changes.metadata = body.metadata;
    }
    if (body.rollbackPlan !== undefined) {
      changes.rollbackPlan = body.rollbackPlan;
    }

    if (Object.keys(changes).length === 0 && !body.submitForApproval) {
      throw new AppError(
        'INVALID_REQUEST',
        'No mutable fields were provided.',
        422,
        'execution-api',
      );
    }

    const updated =
      Object.keys(changes).length > 0
        ? await this.deps.plans.update(
            ctx.tenantId,
            planId,
            changes,
            {
              expectedVersion: body.submitForApproval
                ? current.version
                : body.expectedVersion,
            },
          )
        : current;

    await appendHistory(this.deps, {
      tenantId: ctx.tenantId,
      executionId: planId,
      workflowId: updated.workflowId,
      actorId: ctx.actorId,
      eventType: body.submitForApproval ? 'STATUS_CHANGED' : 'PLAN_UPDATED',
      previousStatus: existing.planStatus,
      nextStatus: updated.planStatus,
    });

    if (body.submitForApproval) {
      const scope = actionLogScopeFromPlan(updated, ctx);
      await emitActionLogSafely(this.deps.actionLogEmitter, () =>
        scope
          ? this.deps.actionLogEmitter!.emitAfterApprovalRequired({
              ...scope,
              occurredAt: new Date().toISOString(),
              reasonCodes: readPolicySnapshot(updated.metadata)?.reasonCodes,
            })
          : Promise.resolve(undefined),
      );
    }

    return updated;
  }

  async listPlans(tenantId: string, query: ExecutionPlanListQuery) {
    if (query.executionId) {
      const plan = await this.deps.plans.getById(tenantId, query.executionId);
      return {
        items: plan ? [plan] : [],
        nextToken: undefined,
      };
    }

    const page = { limit: query.limit, nextToken: query.nextToken };

    if (query.status && query.workflowId) {
      throw new AppError(
        'INVALID_REQUEST',
        'Specify either status or workflowId filter, not both.',
        422,
        'execution-api',
      );
    }

    if (query.status) {
      return this.deps.plans.listByStatus(tenantId, query.status, page);
    }

    if (query.workflowId) {
      return this.deps.plans.listByWorkflow(tenantId, query.workflowId, page);
    }

    return this.deps.plans.listByTenant(tenantId, page);
  }

  async approvePlan(
    ctx: ExecutionApiActorContext,
    planId: string,
    expectedVersion: number,
  ): Promise<ExecutionPlanRecord> {
    const plan = await this.requirePlan(ctx.tenantId, planId);

    if (!plan.approvalRequired) {
      throw new AppError(
        'CONFLICT',
        'Execution plan does not require approval.',
        409,
        'execution-api',
      );
    }

    if (plan.planStatus !== 'PENDING_APPROVAL') {
      throw new AppError(
        'CONFLICT',
        'Plan must be in PENDING_APPROVAL before it can be approved. Submit the plan for approval first.',
        409,
        'execution-api',
      );
    }

    const approved = await this.deps.plans.recordApprovalDecision(
      ctx.tenantId,
      planId,
      { decision: 'APPROVED', actorId: ctx.actorId },
      { expectedVersion },
    );

    const approvedWithProvenance = await this.deps.plans.update(
      ctx.tenantId,
      planId,
      {
        metadata: {
          ...(approved.metadata ?? {}),
          [EXECUTION_PLAN_METADATA_APPROVAL_ACTOR_ROLE]: ctx.actor.roles.join(','),
        },
      },
      { expectedVersion: approved.version },
    );

    await appendHistory(this.deps, {
      tenantId: ctx.tenantId,
      executionId: planId,
      workflowId: approvedWithProvenance.workflowId,
      actorId: ctx.actorId,
      eventType: 'APPROVAL_RECORDED',
      previousStatus: plan.planStatus,
      nextStatus: approvedWithProvenance.planStatus,
      details: { decision: 'APPROVED' },
    });

    const scope = actionLogScopeFromPlan(approvedWithProvenance, ctx);
    await emitActionLogSafely(this.deps.actionLogEmitter, () =>
      scope
        ? this.deps.actionLogEmitter!.emitAfterApprovalGranted({
            ...scope,
            occurredAt: approvedWithProvenance.approvedAt ?? new Date().toISOString(),
            actorId: ctx.actorId,
            reasonCodes: readPolicySnapshot(approvedWithProvenance.metadata)?.reasonCodes,
          })
        : Promise.resolve(undefined),
    );

    return approvedWithProvenance;
  }

  async rejectPlan(
    ctx: ExecutionApiActorContext,
    planId: string,
    expectedVersion: number,
    rejectionReason?: string,
  ): Promise<ExecutionPlanRecord> {
    const plan = await this.requirePlan(ctx.tenantId, planId);

    if (!plan.approvalRequired) {
      throw new AppError(
        'CONFLICT',
        'Execution plan does not require approval.',
        409,
        'execution-api',
      );
    }

    if (plan.planStatus !== 'PENDING_APPROVAL') {
      throw new AppError(
        'CONFLICT',
        'Plan must be in PENDING_APPROVAL before it can be rejected. Submit the plan for approval first.',
        409,
        'execution-api',
      );
    }

    const rejected = await this.deps.plans.recordApprovalDecision(
      ctx.tenantId,
      planId,
      {
        decision: 'REJECTED',
        actorId: ctx.actorId,
        rejectionReason,
      },
      { expectedVersion },
    );

    const rejectedWithProvenance = await this.deps.plans.update(
      ctx.tenantId,
      planId,
      {
        metadata: {
          ...(rejected.metadata ?? {}),
          [EXECUTION_PLAN_METADATA_APPROVAL_ACTOR_ROLE]: ctx.actor.roles.join(','),
          ...(rejectionReason
            ? { [EXECUTION_PLAN_METADATA_APPROVAL_REASON]: rejectionReason }
            : {}),
        },
      },
      { expectedVersion: rejected.version },
    );

    await appendHistory(this.deps, {
      tenantId: ctx.tenantId,
      executionId: planId,
      workflowId: rejectedWithProvenance.workflowId,
      actorId: ctx.actorId,
      eventType: 'APPROVAL_RECORDED',
      previousStatus: plan.planStatus,
      nextStatus: rejectedWithProvenance.planStatus,
      details: { decision: 'REJECTED', rejectionReason },
    });

    const scope = actionLogScopeFromPlan(rejectedWithProvenance, ctx);
    await emitActionLogSafely(this.deps.actionLogEmitter, () =>
      scope
        ? this.deps.actionLogEmitter!.emitAfterApprovalRejected({
            ...scope,
            occurredAt: rejectedWithProvenance.rejectedAt ?? new Date().toISOString(),
            actorId: ctx.actorId,
            reasonCodes: readPolicySnapshot(rejectedWithProvenance.metadata)?.reasonCodes,
          })
        : Promise.resolve(undefined),
    );

    return rejectedWithProvenance;
  }

  async overridePlan(
    ctx: ExecutionApiActorContext,
    planId: string,
    expectedVersion: number,
    input: { overrideDecision: 'APPROVED' | 'REJECTED'; reason: string },
  ): Promise<ExecutionPlanRecord> {
    const plan = await this.requirePlan(ctx.tenantId, planId);

    const originalDecision: ExecutionPlanOverrideEntry['originalDecision'] = {
      approvalStatus: plan.approvalStatus,
      planStatus: plan.planStatus,
      actorId:
        plan.approvalStatus === 'APPROVED' ? plan.approvedBy : plan.rejectedBy,
      decidedAt:
        plan.approvalStatus === 'APPROVED' ? plan.approvedAt : plan.rejectedAt,
    };

    const overridden = await this.deps.plans.recordApprovalOverride(
      ctx.tenantId,
      planId,
      {
        overrideDecision: input.overrideDecision,
        actorId: ctx.actorId,
        actorRole: ctx.actor.roles.join(','),
        reason: input.reason,
      },
      { expectedVersion },
    );

    const provenance = readPolicyProvenance(overridden.metadata);
    const overrideEntry: ExecutionPlanOverrideEntry = {
      actorId: ctx.actorId,
      actorRole: ctx.actor.roles.join(','),
      reason: input.reason,
      overrideDecision: input.overrideDecision,
      originalDecision,
      correlationId: ctx.correlationId,
      policyVersion: provenance?.actionPolicyVersion,
      decidedAt:
        input.overrideDecision === 'APPROVED'
          ? overridden.approvedAt ?? new Date().toISOString()
          : overridden.rejectedAt ?? new Date().toISOString(),
    };

    const overriddenWithProvenance = await this.deps.plans.update(
      ctx.tenantId,
      planId,
      {
        metadata: appendOverrideHistory(overridden.metadata, overrideEntry),
      },
      { expectedVersion: overridden.version },
    );

    await appendHistory(this.deps, {
      tenantId: ctx.tenantId,
      executionId: planId,
      workflowId: overriddenWithProvenance.workflowId,
      actorId: ctx.actorId,
      eventType: 'APPROVAL_RECORDED',
      previousStatus: plan.planStatus,
      nextStatus: overriddenWithProvenance.planStatus,
      details: {
        decision: 'OVERRIDDEN',
        overrideDecision: input.overrideDecision,
        reason: input.reason,
        originalDecision,
      },
    });

    const scope = actionLogScopeFromPlan(overriddenWithProvenance, ctx);
    await emitActionLogSafely(this.deps.actionLogEmitter, () =>
      scope
        ? this.deps.actionLogEmitter!.emitAfterApprovalOverridden({
            ...scope,
            occurredAt: overrideEntry.decidedAt,
            actorId: ctx.actorId,
            reasonCodes: [ACTION_POLICY_REASON.OVERRIDE_APPLIED],
          })
        : Promise.resolve(undefined),
    );

    return overriddenWithProvenance;
  }

  async executePlan(
    ctx: ExecutionApiActorContext,
    planId: string,
    expectedVersion: number,
    regionOverride?: string,
  ) {
    const plan = await this.requirePlan(ctx.tenantId, planId);

    let working = plan;
    if (working.planStatus === 'DRAFT' && !working.approvalRequired) {
      working = await this.deps.plans.transitionStatus(
        ctx.tenantId,
        planId,
        'APPROVED',
        { expectedVersion },
      );
      expectedVersion = working.version;
    }

    if (working.planStatus !== 'APPROVED') {
      throw new AppError(
        'CONFLICT',
        'Execution plan must be APPROVED before execution.',
        409,
        'execution-api',
      );
    }

    try {
      validateExecutionStartAllowed(
        'EXECUTING',
        working.approvalRequired,
        working.approvalStatus,
      );
    } catch (error) {
      if (error instanceof InvalidExecutionApprovalError) {
        throw new AppError('CONFLICT', error.message, 409, 'execution-api');
      }
      throw error;
    }

    assertProductionExecutionEligible(working);

    if (!isAdapterProductionExecutionEnabled()) {
      throw new AppError(
        'EXECUTION_PRODUCTION_DISABLED',
        'Live adapter production execution is not enabled for this environment.',
        422,
        'execution-api',
      );
    }

    const executing = await this.deps.plans.transitionStatus(
      ctx.tenantId,
      planId,
      'EXECUTING',
      { expectedVersion },
    );

    const scope = actionLogScopeFromPlan(executing, ctx);
    await emitActionLogSafely(this.deps.actionLogEmitter, () =>
      scope
        ? this.deps.actionLogEmitter!.emitAfterExecutionStarted({
            ...scope,
            occurredAt: new Date().toISOString(),
            actorId: ctx.actorId,
            reasonCodes: readPolicySnapshot(executing.metadata)?.reasonCodes,
          })
        : Promise.resolve(undefined),
    );

    const adapterRequest = buildAdapterRequest(executing);
    const region = resolveRegion(executing, regionOverride);

    let result;
    try {
      result = await this.deps.orchestrator.run(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          actor: ctx.actor,
          correlationId: ctx.correlationId,
          requestId: ctx.requestId,
          region,
          mode: EXECUTION_MODES.PRODUCTION,
          workflowId: executing.workflowId,
        },
        adapterRequest,
      );
    } catch (error) {
      await this.deps.plans.transitionStatus(
        ctx.tenantId,
        planId,
        'FAILED',
        { expectedVersion: executing.version },
      );
      throw error;
    }

    const run = await this.deps.runs.getById(ctx.tenantId, result.runId);

    let finalStatus: ExecutionPlanStatus = 'FAILED';
    if (result.status === 'SUCCEEDED') {
      finalStatus = 'COMPLETED';
    } else if (result.status === 'ROLLED_BACK') {
      finalStatus = 'ROLLED_BACK';
    }

    const finalized = await this.deps.plans.transitionStatus(
      ctx.tenantId,
      planId,
      finalStatus,
      { expectedVersion: executing.version },
    );

    await this.deps.plans.update(
      ctx.tenantId,
      planId,
      {
        metadata: {
          ...(finalized.metadata ?? {}),
          [EXECUTION_PLAN_METADATA_RUN_ID]: result.runId,
        },
      },
      { expectedVersion: finalized.version },
    );

    await appendHistory(this.deps, {
      tenantId: ctx.tenantId,
      executionId: planId,
      workflowId: executing.workflowId,
      actorId: ctx.actorId,
      eventType: 'STATUS_CHANGED',
      previousStatus: 'EXECUTING',
      nextStatus: finalStatus,
      details: {
        runId: result.runId,
        orchestrationStatus: result.status,
        failureCode: result.failure?.code,
      },
    });

    return {
      plan: finalized,
      run,
      result,
    };
  }

  async simulatePlan(
    ctx: ExecutionApiActorContext,
    planId: string,
    _expectedVersion: number,
    regionOverride?: string,
  ) {
    const plan = await this.requirePlan(ctx.tenantId, planId);
    assertSimulationExecutionEligible(plan);

    const adapterRequest = buildAdapterRequest(plan);
    const region = resolveRegion(plan, regionOverride);

    const result = await this.deps.orchestrator.run(
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        actor: ctx.actor,
        correlationId: ctx.correlationId,
        requestId: ctx.requestId,
        region,
        mode: EXECUTION_MODES.DRY_RUN,
        workflowId: plan.workflowId,
      },
      adapterRequest,
    );

    const scope = actionLogScopeFromPlan(plan, ctx);
    await emitActionLogSafely(this.deps.actionLogEmitter, () =>
      scope
        ? this.deps.actionLogEmitter!.emitAfterExecutionSimulated({
            ...scope,
            occurredAt: new Date().toISOString(),
            actorId: ctx.actorId,
            reasonCodes: readPolicySnapshot(plan.metadata)?.reasonCodes,
          })
        : Promise.resolve(undefined),
    );

    return {
      plan,
      result,
    };
  }

  async rollbackPlan(
    ctx: ExecutionApiActorContext,
    planId: string,
    expectedVersion: number,
  ): Promise<RollbackPlanOutcome> {
    const plan = await this.requirePlan(ctx.tenantId, planId);

    const runId =
      typeof plan.metadata?.[EXECUTION_PLAN_METADATA_RUN_ID] === 'string'
        ? String(plan.metadata[EXECUTION_PLAN_METADATA_RUN_ID])
        : undefined;

    if (!runId) {
      throw new AppError(
        'CONFLICT',
        'No execution run is associated with this plan.',
        409,
        'execution-api',
      );
    }

    const run = await this.deps.runs.getById(ctx.tenantId, runId);
    if (!run) {
      throw new AppError(
        'NOT_FOUND',
        'Execution run was not found.',
        404,
        'execution-api',
      );
    }

    assertRollbackLifecycle(plan, run);

    if (!isAdapterProductionExecutionEnabled()) {
      throw new AppError(
        'EXECUTION_PRODUCTION_DISABLED',
        'Live adapter production execution is not enabled for this environment.',
        422,
        'execution-api',
      );
    }

    const priorRunStatus = run.status;
    let claimedRun: ExecutionRunRecord;

    try {
      claimedRun = await this.deps.runs.update(
        ctx.tenantId,
        runId,
        { status: 'ROLLBACK_PENDING' },
        { expectedVersion: run.version },
      );
    } catch (error) {
      if (error instanceof RepositoryConflictError) {
        throw new AppError(
          'CONFLICT',
          'Resource version conflict.',
          409,
          'execution-api',
        );
      }
      throw error;
    }

    let rollbackResult;
    try {
      rollbackResult = await this.deps.orchestrator.rollbackRun(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          actor: ctx.actor,
          correlationId: ctx.correlationId,
          requestId: ctx.requestId,
          region: claimedRun.region,
          mode: EXECUTION_MODES.PRODUCTION,
          workflowId: plan.workflowId,
        },
        runId,
      );
    } catch (error) {
      await revertRunRollbackClaim(
        this.deps,
        ctx.tenantId,
        runId,
        priorRunStatus,
      );
      if (error instanceof ExecutionAdapterError) {
        throw new AppError(
          'CONFLICT',
          error.message,
          409,
          'execution-api',
        );
      }
      throw error;
    }

    if (rollbackResult.status !== 'ROLLED_BACK') {
      throw new AppError(
        'EXECUTION_ROLLBACK_FAILED',
        rollbackResult.rollbackFailure?.message ??
          'Execution rollback failed.',
        409,
        'execution-api',
      );
    }

    const rolledPlan = await this.deps.plans.transitionStatus(
      ctx.tenantId,
      planId,
      'ROLLED_BACK',
      { expectedVersion },
    );

    await appendHistory(this.deps, {
      tenantId: ctx.tenantId,
      executionId: planId,
      workflowId: plan.workflowId,
      actorId: ctx.actorId,
      eventType: 'STATUS_CHANGED',
      previousStatus: plan.planStatus,
      nextStatus: 'ROLLED_BACK',
      details: { runId, orchestrationStatus: rollbackResult.status },
    });

    return {
      plan: rolledPlan,
      run: await this.deps.runs.getById(ctx.tenantId, runId),
      result: rollbackResult,
      rollbackRequested: true,
    };
  }

  async getStatus(tenantId: string, planId: string) {
    const plan = await this.requirePlan(tenantId, planId);
    const runId =
      typeof plan.metadata?.[EXECUTION_PLAN_METADATA_RUN_ID] === 'string'
        ? String(plan.metadata[EXECUTION_PLAN_METADATA_RUN_ID])
        : undefined;
    const run = runId
      ? await this.deps.runs.getById(tenantId, runId)
      : undefined;

    return { plan, run };
  }

  async listRuns(tenantId: string, query: { limit?: number; nextToken?: string }) {
    return this.deps.runs.listByTenant(tenantId, query);
  }

  async getRun(tenantId: string, runId: string) {
    return this.deps.runs.getById(tenantId, runId);
  }

  private async requirePlan(tenantId: string, planId: string): Promise<ExecutionPlanRecord> {
    const plan = await this.deps.plans.getById(tenantId, planId);
    if (!plan) {
      throw new RepositoryNotFoundError(`Execution plan ${planId} was not found.`);
    }
    return plan;
  }
}

export function mapExecutionServiceError(error: unknown): AppError | unknown {
  if (error instanceof InvalidExecutionTransitionError) {
    return new AppError('CONFLICT', error.message, 409, 'execution-api');
  }
  if (error instanceof InvalidExecutionOverrideError) {
    return new AppError('CONFLICT', error.message, 409, 'execution-api');
  }
  if (error instanceof RepositoryConflictError) {
    return new AppError('CONFLICT', 'Resource version conflict.', 409, 'execution-api');
  }
  if (error instanceof RepositoryNotFoundError) {
    return new AppError('NOT_FOUND', 'Execution plan was not found.', 404, 'execution-api');
  }
  return error;
}
