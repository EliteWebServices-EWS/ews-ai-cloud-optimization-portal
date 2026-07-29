import type {
  TenantRecordIdentity,
  VersionedRecord,
} from '../contracts/repository-types';

export type ExecutionPlanStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ROLLED_BACK';

export type ExecutionApprovalStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED';

export type ExecutionRiskLevel =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'CRITICAL';

export interface ExecutionStepRecord {
  stepId: string;
  order: number;
  actionType: string;
  resourceType: string;
  resourceId: string;
  description: string;
  parameters?: Record<string, unknown>;
  validationRequirements?: string[];
  expectedOutcome?: string;
  rollbackStepId?: string;
  metadata?: Record<string, unknown>;
}

export interface RollbackPlanRecord {
  strategy: string;
  steps: ExecutionStepRecord[];
  automatic: boolean;
  conditions?: string[];
  estimatedDurationMinutes?: number;
  metadata?: Record<string, unknown>;
}

export interface ExecutionPlanRecord
  extends TenantRecordIdentity,
    VersionedRecord {
  executionId: string;
  workflowId: string;
  recommendationId: string;
  planStatus: ExecutionPlanStatus;
  createdBy: string;
  executionSteps: ExecutionStepRecord[];
  rollbackPlan: RollbackPlanRecord;
  riskLevel: ExecutionRiskLevel;
  approvalRequired: boolean;
  approvalStatus: ExecutionApprovalStatus;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  metadata?: Record<string, unknown>;
}

export type ExecutionHistoryEventType =
  | 'PLAN_CREATED'
  | 'STATUS_CHANGED'
  | 'APPROVAL_RECORDED'
  | 'PLAN_UPDATED'
  | 'EXECUTION_NOTE';

/**
 * Append-only execution audit trail. History rows are never updated and do
 * not participate in optimistic locking (no {@link VersionedRecord}).
 */
export interface ExecutionHistoryRecord extends TenantRecordIdentity {
  historyId: string;
  executionId: string;
  workflowId: string;
  eventType: ExecutionHistoryEventType;
  previousStatus?: ExecutionPlanStatus;
  nextStatus?: ExecutionPlanStatus;
  actorId: string;
  createdAt: string;
  details?: Record<string, unknown>;
}

export const EXECUTION_RISK_LEVELS: readonly ExecutionRiskLevel[] = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;

export class ExecutionPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutionPlanValidationError';
  }
}

function assertJsonSerializable(
  value: unknown,
  fieldName: string,
): void {
  try {
    JSON.stringify(value);
  } catch {
    throw new ExecutionPlanValidationError(
      `${fieldName} must be JSON serializable.`,
    );
  }
}

function validateExecutionSteps(steps: ExecutionStepRecord[]): void {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new ExecutionPlanValidationError(
      'At least one execution step is required.',
    );
  }

  const stepIds = new Set<string>();
  const orders = new Set<number>();

  for (const step of steps) {
    if (!step.stepId?.trim()) {
      throw new ExecutionPlanValidationError(
        'Each execution step must include a non-empty stepId.',
      );
    }
    if (stepIds.has(step.stepId)) {
      throw new ExecutionPlanValidationError(
        `Duplicate execution stepId: ${step.stepId}.`,
      );
    }
    stepIds.add(step.stepId);

    if (!Number.isInteger(step.order) || step.order < 0) {
      throw new ExecutionPlanValidationError(
        `Execution step ${step.stepId} must have a non-negative integer order.`,
      );
    }
    if (orders.has(step.order)) {
      throw new ExecutionPlanValidationError(
        `Duplicate execution step order: ${step.order}.`,
      );
    }
    orders.add(step.order);

    if (step.metadata !== undefined) {
      assertJsonSerializable(step.metadata, 'executionSteps[].metadata');
    }
    if (step.parameters !== undefined) {
      assertJsonSerializable(step.parameters, 'executionSteps[].parameters');
    }
  }

  const sortedOrders = [...orders].sort((left, right) => left - right);
  for (let index = 0; index < sortedOrders.length; index += 1) {
    if (sortedOrders[index] !== index) {
      throw new ExecutionPlanValidationError(
        'Execution step order must be contiguous starting at 0.',
      );
    }
  }
}

function validateApprovalConsistency(
  approvalRequired: boolean,
  approvalStatus: ExecutionApprovalStatus,
  planStatus: ExecutionPlanStatus,
): void {
  if (!approvalRequired) {
    if (approvalStatus !== 'NOT_REQUIRED') {
      throw new ExecutionPlanValidationError(
        'When approvalRequired is false, approvalStatus must be NOT_REQUIRED.',
      );
    }
    return;
  }

  if (approvalStatus === 'NOT_REQUIRED') {
    throw new ExecutionPlanValidationError(
      'When approvalRequired is true, approvalStatus cannot be NOT_REQUIRED.',
    );
  }

  if (
    planStatus === 'DRAFT' &&
    approvalStatus !== 'PENDING' &&
    approvalStatus !== 'REJECTED'
  ) {
    throw new ExecutionPlanValidationError(
      'Draft plans requiring approval must start with approvalStatus PENDING unless already rejected.',
    );
  }
}

/**
 * Validates invariants for creating or replacing execution-plan content.
 */
export function validateExecutionPlanShape(
  input: Pick<
    ExecutionPlanRecord,
    | 'executionId'
    | 'tenantId'
    | 'workflowId'
    | 'recommendationId'
    | 'createdBy'
    | 'executionSteps'
    | 'rollbackPlan'
    | 'riskLevel'
    | 'approvalRequired'
    | 'approvalStatus'
    | 'planStatus'
    | 'metadata'
  >,
): void {
  for (const field of [
    'executionId',
    'tenantId',
    'workflowId',
    'recommendationId',
    'createdBy',
  ] as const) {
    if (!input[field]?.trim()) {
      throw new ExecutionPlanValidationError(
        `${field} must not be empty.`,
      );
    }
  }

  if (!EXECUTION_RISK_LEVELS.includes(input.riskLevel)) {
    throw new ExecutionPlanValidationError(
      `Unsupported riskLevel: ${input.riskLevel}.`,
    );
  }

  validateExecutionSteps(input.executionSteps);

  if (!input.rollbackPlan?.strategy?.trim()) {
    throw new ExecutionPlanValidationError(
      'rollbackPlan.strategy must not be empty.',
    );
  }
  if (input.rollbackPlan.steps.length > 0) {
    validateExecutionSteps(input.rollbackPlan.steps);
  }
  if (input.rollbackPlan.metadata !== undefined) {
    assertJsonSerializable(input.rollbackPlan.metadata, 'rollbackPlan.metadata');
  }

  validateApprovalConsistency(
    input.approvalRequired,
    input.approvalStatus,
    input.planStatus,
  );

  if (input.metadata !== undefined) {
    assertJsonSerializable(input.metadata, 'metadata');
  }
}

export function validateAppendExecutionHistoryInput(
  input: Pick<
    ExecutionHistoryRecord,
    | 'historyId'
    | 'tenantId'
    | 'executionId'
    | 'workflowId'
    | 'eventType'
    | 'actorId'
    | 'createdAt'
    | 'details'
  >,
): void {
  for (const field of [
    'historyId',
    'tenantId',
    'executionId',
    'workflowId',
    'eventType',
    'actorId',
    'createdAt',
  ] as const) {
    if (!input[field]?.trim()) {
      throw new ExecutionPlanValidationError(
        `${field} must not be empty.`,
      );
    }
  }

  if (input.details !== undefined) {
    assertJsonSerializable(input.details, 'details');
  }
}
