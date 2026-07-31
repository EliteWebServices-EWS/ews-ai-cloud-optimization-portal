import {
  EXECUTION_RISK_LEVELS,
  ExecutionPlanValidationError,
  type ExecutionPlanStatus,
  type ExecutionRiskLevel,
  type ExecutionStepRecord,
  type RollbackPlanRecord,
} from '../repositories/models/execution-persistence-models';
import { AppError } from '../shared/utils';

const PLAN_STATUSES: readonly ExecutionPlanStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'ROLLED_BACK',
];

const METADATA_MAX_BYTES = 16_384;

export class ExecutionApiValidationError extends AppError {
  constructor(message: string) {
    super('INVALID_REQUEST', message, 422, 'execution-api');
    this.name = 'ExecutionApiValidationError';
  }
}

function assertPlainObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExecutionApiValidationError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function validateMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const metadata = assertPlainObject(value, 'metadata');
  const serialized = JSON.stringify(metadata);
  if (serialized.length > METADATA_MAX_BYTES) {
    throw new ExecutionApiValidationError('metadata exceeds maximum size.');
  }
  return metadata;
}

function validateStep(step: unknown, index: number): ExecutionStepRecord {
  const record = assertPlainObject(step, `executionSteps[${index}]`);
  const requiredStrings = [
    'stepId',
    'actionType',
    'resourceType',
    'resourceId',
    'description',
  ] as const;

  for (const field of requiredStrings) {
    if (typeof record[field] !== 'string' || !String(record[field]).trim()) {
      throw new ExecutionApiValidationError(
        `executionSteps[${index}].${field} is required.`,
      );
    }
  }

  if (record.order === undefined || record.order === null) {
    throw new ExecutionApiValidationError(
      `executionSteps[${index}].order is required.`,
    );
  }

  if (typeof record.order !== 'number' || !Number.isInteger(record.order)) {
    throw new ExecutionApiValidationError(
      `executionSteps[${index}].order must be an integer.`,
    );
  }

  return {
    stepId: String(record.stepId).trim(),
    order: record.order,
    actionType: String(record.actionType).trim(),
    resourceType: String(record.resourceType).trim(),
    resourceId: String(record.resourceId).trim(),
    description: String(record.description).trim(),
    parameters:
      record.parameters === undefined
        ? undefined
        : assertPlainObject(record.parameters, `executionSteps[${index}].parameters`),
    validationRequirements: Array.isArray(record.validationRequirements)
      ? record.validationRequirements.map(String)
      : undefined,
    expectedOutcome:
      typeof record.expectedOutcome === 'string'
        ? record.expectedOutcome
        : undefined,
    rollbackStepId:
      typeof record.rollbackStepId === 'string'
        ? record.rollbackStepId
        : undefined,
    metadata:
      record.metadata === undefined
        ? undefined
        : assertPlainObject(record.metadata, `executionSteps[${index}].metadata`),
  };
}

function validateRollbackPlan(value: unknown): RollbackPlanRecord {
  const plan = assertPlainObject(value, 'rollbackPlan');
  if (typeof plan.strategy !== 'string' || !plan.strategy.trim()) {
    throw new ExecutionApiValidationError('rollbackPlan.strategy is required.');
  }
  if (typeof plan.automatic !== 'boolean') {
    throw new ExecutionApiValidationError('rollbackPlan.automatic is required.');
  }

  const steps = Array.isArray(plan.steps)
    ? plan.steps.map((step, index) => validateStep(step, index))
    : [];

  return {
    strategy: plan.strategy.trim(),
    steps,
    automatic: plan.automatic,
    conditions: Array.isArray(plan.conditions)
      ? plan.conditions.map(String)
      : undefined,
    estimatedDurationMinutes:
      typeof plan.estimatedDurationMinutes === 'number'
        ? plan.estimatedDurationMinutes
        : undefined,
    metadata:
      plan.metadata === undefined
        ? undefined
        : assertPlainObject(plan.metadata, 'rollbackPlan.metadata'),
  };
}

export interface CreateExecutionPlanBody {
  workflowId: string;
  recommendationId: string;
  executionSteps: ExecutionStepRecord[];
  rollbackPlan: RollbackPlanRecord;
  riskLevel: ExecutionRiskLevel;
  approvalRequired: boolean;
  metadata?: Record<string, unknown>;
  region?: string;
}

export function validateCreateExecutionPlanBody(body: unknown): CreateExecutionPlanBody {
  const input = assertPlainObject(body, 'body');

  for (const field of ['workflowId', 'recommendationId'] as const) {
    if (typeof input[field] !== 'string' || !input[field].trim()) {
      throw new ExecutionApiValidationError(`${field} is required.`);
    }
  }

  if (!Array.isArray(input.executionSteps) || input.executionSteps.length === 0) {
    throw new ExecutionApiValidationError('executionSteps must be a non-empty array.');
  }

  const riskLevel = String(input.riskLevel ?? '') as ExecutionRiskLevel;
  if (!EXECUTION_RISK_LEVELS.includes(riskLevel)) {
    throw new ExecutionApiValidationError(`Unsupported riskLevel: ${riskLevel}.`);
  }

  if (typeof input.approvalRequired !== 'boolean') {
    throw new ExecutionApiValidationError('approvalRequired must be a boolean.');
  }

  if (input.tenantId !== undefined) {
    throw new ExecutionApiValidationError('tenantId must not be supplied in the request body.');
  }

  return {
    workflowId: String(input.workflowId).trim(),
    recommendationId: String(input.recommendationId).trim(),
    executionSteps: input.executionSteps.map((step, index) =>
      validateStep(step, index),
    ),
    rollbackPlan: validateRollbackPlan(input.rollbackPlan),
    riskLevel,
    approvalRequired: input.approvalRequired,
    metadata: validateMetadata(input.metadata),
    region:
      typeof input.region === 'string' && input.region.trim()
        ? input.region.trim()
        : undefined,
  };
}

export interface UpdateExecutionPlanBody {
  metadata?: Record<string, unknown>;
  rollbackPlan?: RollbackPlanRecord;
  expectedVersion: number;
  submitForApproval?: boolean;
}

export function validateUpdateExecutionPlanBody(body: unknown): UpdateExecutionPlanBody {
  const input = assertPlainObject(body, 'body');

  if (input.planStatus !== undefined || input.approvalStatus !== undefined) {
    throw new ExecutionApiValidationError(
      'planStatus and approvalStatus must be changed through lifecycle endpoints.',
    );
  }

  if (input.tenantId !== undefined) {
    throw new ExecutionApiValidationError('tenantId must not be supplied in the request body.');
  }

  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ExecutionApiValidationError('expectedVersion must be a positive integer.');
  }

  return {
    expectedVersion,
    metadata:
      input.metadata === undefined
        ? undefined
        : validateMetadata(input.metadata),
    rollbackPlan:
      input.rollbackPlan === undefined
        ? undefined
        : validateRollbackPlan(input.rollbackPlan),
    submitForApproval: input.submitForApproval === true,
  };
}

export function validateExpectedVersionQuery(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ExecutionApiValidationError('expectedVersion must be a positive integer.');
  }
  return parsed;
}

export function validateRejectionBody(body: unknown): { rejectionReason?: string; expectedVersion: number } {
  const input = assertPlainObject(body, 'body');
  const expectedVersion = validateExpectedVersionQuery(input.expectedVersion);

  const rejectionReason =
    typeof input.rejectionReason === 'string' && input.rejectionReason.trim()
      ? input.rejectionReason.trim()
      : undefined;

  return { expectedVersion, rejectionReason };
}

export function validateApprovalBody(body: unknown): { expectedVersion: number } {
  const input = assertPlainObject(body, 'body');
  return { expectedVersion: validateExpectedVersionQuery(input.expectedVersion) };
}

export function validateExecuteBody(body: unknown): { expectedVersion: number; region?: string } {
  const input = assertPlainObject(body, 'body');
  return {
    expectedVersion: validateExpectedVersionQuery(input.expectedVersion),
    region:
      typeof input.region === 'string' && input.region.trim()
        ? input.region.trim()
        : undefined,
  };
}

export interface ExecutionPlanListQuery {
  limit?: number;
  nextToken?: string;
  status?: ExecutionPlanStatus;
  workflowId?: string;
  executionId?: string;
  sort?: 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export function parseExecutionPlanListQuery(query: Record<string, unknown>): ExecutionPlanListQuery {
  const limitRaw = query.limit;
  let limit: number | undefined;
  if (limitRaw !== undefined) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ExecutionApiValidationError('limit must be an integer between 1 and 100.');
    }
  }

  const status =
    typeof query.status === 'string' && query.status.trim()
      ? (query.status.trim().toUpperCase() as ExecutionPlanStatus)
      : undefined;

  if (status && !PLAN_STATUSES.includes(status)) {
    throw new ExecutionApiValidationError(`Unsupported status filter: ${status}.`);
  }

  const sort = query.sort === undefined ? undefined : String(query.sort);
  if (sort !== undefined && sort !== 'createdAt') {
    throw new ExecutionApiValidationError('Unsupported sort field. Only createdAt is supported.');
  }

  const sortOrder =
    query.sortOrder === undefined
      ? undefined
      : (String(query.sortOrder).toLowerCase() as 'asc' | 'desc');

  if (sortOrder && sortOrder !== 'asc' && sortOrder !== 'desc') {
    throw new ExecutionApiValidationError('sortOrder must be asc or desc.');
  }

  if (sortOrder === 'asc') {
    throw new ExecutionApiValidationError(
      'Ascending sort is not supported for execution plan listings.',
    );
  }

  return {
    limit,
    nextToken:
      typeof query.nextToken === 'string' && query.nextToken.trim()
        ? query.nextToken.trim()
        : undefined,
    status,
    workflowId:
      typeof query.workflowId === 'string' && query.workflowId.trim()
        ? query.workflowId.trim()
        : undefined,
    executionId:
      typeof query.executionId === 'string' && query.executionId.trim()
        ? query.executionId.trim()
        : undefined,
    sort: sort as 'createdAt' | undefined,
    sortOrder,
  };
}

export function parseExecutionRunListQuery(query: Record<string, unknown>): {
  limit?: number;
  nextToken?: string;
} {
  const limitRaw = query.limit;
  let limit: number | undefined;
  if (limitRaw !== undefined) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ExecutionApiValidationError('limit must be an integer between 1 and 100.');
    }
  }

  return {
    limit,
    nextToken:
      typeof query.nextToken === 'string' && query.nextToken.trim()
        ? query.nextToken.trim()
        : undefined,
  };
}

export function mapExecutionPlanValidationError(error: unknown): never {
  if (error instanceof ExecutionPlanValidationError) {
    throw new ExecutionApiValidationError(error.message);
  }
  throw error;
}
