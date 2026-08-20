import {
  EXECUTION_RISK_LEVELS,
  ExecutionPlanValidationError,
  type ExecutionPlanStatus,
  type ExecutionRiskLevel,
  type ExecutionStepRecord,
  type RollbackPlanRecord,
} from '../repositories/models/execution-persistence-models';
import { ACTION_MODES, type ActionMode } from '../action-policy/types';
import { ML_DECISION_FALLBACKS } from '../action-policy/ml-decision-summary';
import { DECISION_READINESS_STATES } from '../decision-readiness/types';
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

export interface ActionPolicyContextBody {
  accountId: string;
  decisionId?: string;
  findingKey?: string;
  resourceId?: string;
  actionMode: ActionMode;
  infrastructureChanging: boolean;
  decisionReadiness: {
    readiness: (typeof DECISION_READINESS_STATES)[number];
    reasonCodes: readonly string[];
    policyVersion: string;
    recommendedAction: string;
  };
  mlDecisionSummary?: {
    eligibility: 'ML_ELIGIBLE' | 'ML_INELIGIBLE';
    outcome: 'EXECUTED' | 'SKIPPED' | 'FAILED_SAFE';
    fallback?: (typeof ML_DECISION_FALLBACKS)[number];
    modelVersion?: string;
  };
}

function validatePolicyContext(value: unknown): ActionPolicyContextBody | undefined {
  if (value === undefined) {
    return undefined;
  }

  const input = assertPlainObject(value, 'policyContext');
  const accountId = String(input.accountId ?? '').trim();
  if (!accountId) {
    throw new ExecutionApiValidationError('policyContext.accountId is required.');
  }

  const actionMode = String(input.actionMode ?? '') as ActionMode;
  if (!ACTION_MODES.includes(actionMode)) {
    throw new ExecutionApiValidationError(`Unsupported policyContext.actionMode: ${actionMode}.`);
  }

  if (typeof input.infrastructureChanging !== 'boolean') {
    throw new ExecutionApiValidationError('policyContext.infrastructureChanging must be a boolean.');
  }

  const readinessInput = assertPlainObject(input.decisionReadiness, 'policyContext.decisionReadiness');
  const readiness = String(readinessInput.readiness ?? '') as ActionPolicyContextBody['decisionReadiness']['readiness'];
  if (!DECISION_READINESS_STATES.includes(readiness)) {
    throw new ExecutionApiValidationError(`Unsupported policyContext.decisionReadiness.readiness: ${readiness}.`);
  }

  if (!Array.isArray(readinessInput.reasonCodes)) {
    throw new ExecutionApiValidationError('policyContext.decisionReadiness.reasonCodes must be an array.');
  }

  const policyVersion = String(readinessInput.policyVersion ?? '').trim();
  const recommendedAction = String(readinessInput.recommendedAction ?? '').trim();
  if (!policyVersion || !recommendedAction) {
    throw new ExecutionApiValidationError(
      'policyContext.decisionReadiness.policyVersion and recommendedAction are required.',
    );
  }

  let mlDecisionSummary: ActionPolicyContextBody['mlDecisionSummary'];
  if (input.mlDecisionSummary !== undefined) {
    const ml = assertPlainObject(input.mlDecisionSummary, 'policyContext.mlDecisionSummary');
    const eligibility = String(ml.eligibility ?? '');
    const outcome = String(ml.outcome ?? '');
    if (eligibility !== 'ML_ELIGIBLE' && eligibility !== 'ML_INELIGIBLE') {
      throw new ExecutionApiValidationError('policyContext.mlDecisionSummary.eligibility is invalid.');
    }
    if (outcome !== 'EXECUTED' && outcome !== 'SKIPPED' && outcome !== 'FAILED_SAFE') {
      throw new ExecutionApiValidationError('policyContext.mlDecisionSummary.outcome is invalid.');
    }
    const fallback = ml.fallback === undefined ? undefined : String(ml.fallback);
    if (fallback !== undefined && !ML_DECISION_FALLBACKS.includes(fallback as never)) {
      throw new ExecutionApiValidationError('policyContext.mlDecisionSummary.fallback is invalid.');
    }
    mlDecisionSummary = {
      eligibility: eligibility as 'ML_ELIGIBLE' | 'ML_INELIGIBLE',
      outcome: outcome as 'EXECUTED' | 'SKIPPED' | 'FAILED_SAFE',
      fallback: fallback as ActionPolicyContextBody['mlDecisionSummary'] extends infer T
        ? T extends { fallback?: infer F }
          ? F
          : never
        : never,
      modelVersion:
        typeof ml.modelVersion === 'string' && ml.modelVersion.trim()
          ? ml.modelVersion.trim()
          : undefined,
    };
  }

  return {
    accountId,
    decisionId:
      typeof input.decisionId === 'string' && input.decisionId.trim()
        ? input.decisionId.trim()
        : undefined,
    findingKey:
      typeof input.findingKey === 'string' && input.findingKey.trim()
        ? input.findingKey.trim()
        : undefined,
    resourceId:
      typeof input.resourceId === 'string' && input.resourceId.trim()
        ? input.resourceId.trim()
        : undefined,
    actionMode,
    infrastructureChanging: input.infrastructureChanging,
    decisionReadiness: {
      readiness,
      reasonCodes: readinessInput.reasonCodes.map((code) => String(code)),
      policyVersion,
      recommendedAction,
    },
    mlDecisionSummary,
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
  policyContext?: ActionPolicyContextBody;
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
    policyContext: validatePolicyContext(input.policyContext),
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
