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
