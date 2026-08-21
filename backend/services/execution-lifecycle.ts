import type {
  ExecutionApprovalStatus,
  ExecutionPlanStatus,
} from '../repositories/models/execution-persistence-models';
const ALLOWED_TRANSITIONS: Record<
  ExecutionPlanStatus,
  readonly ExecutionPlanStatus[]
> = {
  DRAFT: ['PENDING_APPROVAL', 'APPROVED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
  APPROVED: ['EXECUTING'],
  REJECTED: [],
  EXECUTING: ['COMPLETED', 'FAILED'],
  /** Authorized reversal of a completed plan; authorization is enforced by callers, not this module. */
  COMPLETED: ['ROLLED_BACK'],
  FAILED: ['ROLLED_BACK'],
  ROLLED_BACK: [],
};
export class InvalidExecutionTransitionError extends Error {
  constructor(
    currentStatus: ExecutionPlanStatus,
    nextStatus: ExecutionPlanStatus,
  ) {
    super(
      `Execution plan cannot transition from ${currentStatus} to ${nextStatus}.`,
    );
    this.name = 'InvalidExecutionTransitionError';
  }
}
export class InvalidExecutionApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidExecutionApprovalError';
  }
}
export class InvalidExecutionOverrideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidExecutionOverrideError';
  }
}
export interface ExecutionTransitionContext {
  approvalRequired: boolean;
  approvalStatus: ExecutionApprovalStatus;
}
/**
 * Validates plan-status transitions. Approval gating for EXECUTING is enforced
 * separately via {@link validateExecutionStartAllowed}.
 */
export function validateExecutionTransition(
  currentStatus: ExecutionPlanStatus,
  nextStatus: ExecutionPlanStatus,
  context?: ExecutionTransitionContext,
): void {
  if (currentStatus === nextStatus) {
    throw new InvalidExecutionTransitionError(
      currentStatus,
      nextStatus,
    );
  }
  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowed.includes(nextStatus)) {
    throw new InvalidExecutionTransitionError(
      currentStatus,
      nextStatus,
    );
  }
  if (
    currentStatus === 'DRAFT' &&
    nextStatus === 'APPROVED' &&
    context?.approvalRequired
  ) {
    throw new InvalidExecutionTransitionError(
      currentStatus,
      nextStatus,
    );
  }
}
export function validateExecutionStartAllowed(
  planStatus: ExecutionPlanStatus,
  approvalRequired: boolean,
  approvalStatus: ExecutionApprovalStatus,
): void {
  if (planStatus !== 'EXECUTING') {
    return;
  }
  if (approvalRequired && approvalStatus !== 'APPROVED') {
    throw new InvalidExecutionApprovalError(
      'Plans requiring approval must have approvalStatus APPROVED before EXECUTING.',
    );
  }
}
export function approvalFieldsForDecision(input: {
  decision: 'APPROVED' | 'REJECTED';
  actorId: string;
  decidedAt: string;
  rejectionReason?: string;
}): Pick<
  import('../repositories/models/execution-persistence-models').ExecutionPlanRecord,
  | 'planStatus'
  | 'approvalStatus'
  | 'approvedBy'
  | 'approvedAt'
  | 'rejectedBy'
  | 'rejectedAt'
  | 'rejectionReason'
> {
  if (input.decision === 'APPROVED') {
    return {
      planStatus: 'APPROVED',
      approvalStatus: 'APPROVED',
      approvedBy: input.actorId,
      approvedAt: input.decidedAt,
      rejectedBy: undefined,
      rejectedAt: undefined,
      rejectionReason: undefined,
    };
  }
  return {
    planStatus: 'REJECTED',
    approvalStatus: 'REJECTED',
    rejectedBy: input.actorId,
    rejectedAt: input.decidedAt,
    rejectionReason: input.rejectionReason,
    approvedBy: undefined,
    approvedAt: undefined,
  };
}
export function getAllowedExecutionTransitions(
  currentStatus: ExecutionPlanStatus,
): readonly ExecutionPlanStatus[] {
  return ALLOWED_TRANSITIONS[currentStatus];
}

/**
 * Plan statuses from which a privileged actor may override a prior approval
 * decision. Overriding reverses a *decided* approval outcome (REJECTED <->
 * APPROVED) - it is not a substitute for the ordinary approve/reject flow and
 * is never reachable from DRAFT/PENDING_APPROVAL/EXECUTING/terminal-execution
 * statuses. Execution already in flight or complete is out of scope for
 * override; rollback exists for that.
 */
const OVERRIDE_ELIGIBLE_PLAN_STATUSES: readonly ExecutionPlanStatus[] = [
  'APPROVED',
  'REJECTED',
];

export function assertOverrideEligiblePlanStatus(
  planStatus: ExecutionPlanStatus,
  approvalRequired: boolean,
): void {
  if (!approvalRequired) {
    throw new InvalidExecutionOverrideError(
      'Only plans that require approval can have their approval decision overridden.',
    );
  }

  if (!OVERRIDE_ELIGIBLE_PLAN_STATUSES.includes(planStatus)) {
    throw new InvalidExecutionOverrideError(
      `Execution plan in status ${planStatus} is not eligible for approval override. ` +
        `Overridable statuses: ${OVERRIDE_ELIGIBLE_PLAN_STATUSES.join(', ')}.`,
    );
  }
}

/**
 * Derives the persisted plan/approval fields for an approval override.
 * The override decision must reverse the plan's current decided outcome -
 * overriding to the same outcome is rejected by the caller before this runs.
 */
export function overrideApprovalFields(input: {
  overrideDecision: 'APPROVED' | 'REJECTED';
  actorId: string;
  decidedAt: string;
  reason: string;
}): Pick<
  import('../repositories/models/execution-persistence-models').ExecutionPlanRecord,
  | 'planStatus'
  | 'approvalStatus'
  | 'approvedBy'
  | 'approvedAt'
  | 'rejectedBy'
  | 'rejectedAt'
  | 'rejectionReason'
> {
  return approvalFieldsForDecision({
    decision: input.overrideDecision,
    actorId: input.actorId,
    decidedAt: input.decidedAt,
    rejectionReason:
      input.overrideDecision === 'REJECTED' ? input.reason : undefined,
  });
}
