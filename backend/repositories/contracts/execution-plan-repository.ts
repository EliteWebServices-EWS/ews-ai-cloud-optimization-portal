import type {
  ExecutionApprovalStatus,
  ExecutionPlanStatus,
  ExecutionPlanRecord,
} from '../models';

import type {
  PageRequest,
  PageResult,
  UpdateOptions,
} from './repository-types';

export type CreateExecutionPlanInput = Omit<
  ExecutionPlanRecord,
  'version' | 'createdAt' | 'updatedAt'
>;

export type UpdateExecutionPlanInput = Partial<
  Omit<
    ExecutionPlanRecord,
    | 'tenantId'
    | 'executionId'
    | 'workflowId'
    | 'recommendationId'
    | 'createdBy'
    | 'version'
    | 'createdAt'
    | 'updatedAt'
  >
>;

export interface ExecutionApprovalDecisionInput {
  decision: 'APPROVED' | 'REJECTED';
  actorId: string;
  decidedAt?: string;
  rejectionReason?: string;
}

export interface ExecutionPlanRepository {
  create(input: CreateExecutionPlanInput): Promise<ExecutionPlanRecord>;

  getById(
    tenantId: string,
    executionId: string,
  ): Promise<ExecutionPlanRecord | undefined>;

  update(
    tenantId: string,
    executionId: string,
    changes: UpdateExecutionPlanInput,
    options: UpdateOptions,
  ): Promise<ExecutionPlanRecord>;

  transitionStatus(
    tenantId: string,
    executionId: string,
    nextStatus: ExecutionPlanStatus,
    options: UpdateOptions,
  ): Promise<ExecutionPlanRecord>;

  recordApprovalDecision(
    tenantId: string,
    executionId: string,
    decision: ExecutionApprovalDecisionInput,
    options: UpdateOptions,
  ): Promise<ExecutionPlanRecord>;

  listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<ExecutionPlanRecord>>;

  listByWorkflow(
    tenantId: string,
    workflowId: string,
    page?: PageRequest,
  ): Promise<PageResult<ExecutionPlanRecord>>;

  listByStatus(
    tenantId: string,
    status: ExecutionPlanStatus,
    page?: PageRequest,
  ): Promise<PageResult<ExecutionPlanRecord>>;
}

export function assertApprovalStatusForPlan(
  plan: Pick<
    ExecutionPlanRecord,
    'approvalRequired' | 'approvalStatus' | 'planStatus'
  >,
): void {
  if (
    plan.approvalRequired &&
    plan.planStatus === 'EXECUTING' &&
    plan.approvalStatus !== 'APPROVED'
  ) {
    throw new Error(
      'Execution cannot begin until approvalStatus is APPROVED.',
    );
  }
}

export function initialApprovalStatus(
  approvalRequired: boolean,
): ExecutionApprovalStatus {
  return approvalRequired ? 'PENDING' : 'NOT_REQUIRED';
}
