import {
  InvalidPaginationTokenError,
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  RepositoryNotFoundError,
} from '../../database';
import {
  decodeScopedNextToken,
  encodeScopedNextToken,
} from '../../persistence/scoped-pagination-token';
import { EXECUTION_PAGINATION_SCOPES } from '../../persistence/execution-pagination-scopes';

import type {
  CreateExecutionPlanInput,
  ExecutionApprovalDecisionInput,
  ExecutionPlanRepository,
  PageRequest,
  PageResult,
  UpdateExecutionPlanInput,
  UpdateOptions,
} from '../contracts';

import { normalizePageSize } from '../contracts/repository-types';

import type {
  ExecutionPlanRecord,
  ExecutionPlanStatus,
} from '../models';

import {
  validateExecutionPlanShape,
} from '../models/execution-persistence-models';

import {
  approvalFieldsForDecision,
  validateExecutionStartAllowed,
  validateExecutionTransition,
} from '../../services/execution-lifecycle';

function clone(record: ExecutionPlanRecord): ExecutionPlanRecord {
  return structuredClone(record);
}

function planKey(tenantId: string, executionId: string): string {
  return `${tenantId}#${executionId}`;
}

function byCreatedAtDescending(
  left: ExecutionPlanRecord,
  right: ExecutionPlanRecord,
): number {
  const createdCompare = right.createdAt.localeCompare(left.createdAt);
  if (createdCompare !== 0) {
    return createdCompare;
  }
  return right.executionId.localeCompare(left.executionId);
}

function paginateScoped<T>(
  tenantId: string,
  scope: string,
  records: T[],
  page: PageRequest | undefined,
  cloneItem: (item: T) => T,
): PageResult<T> {
  const limit = normalizePageSize(page?.limit);
  let offset = 0;

  if (page?.nextToken) {
    try {
      const key = decodeScopedNextToken(page.nextToken, {
        tenantId,
        scope,
      }) as { offset?: number } | undefined;
      offset = key?.offset ?? 0;
    } catch {
      throw new InvalidPaginationTokenError();
    }
  }

  const items = records.slice(offset, offset + limit).map(cloneItem);
  const nextOffset = offset + items.length;

  return {
    items,
    nextToken:
      nextOffset < records.length
        ? encodeScopedNextToken(
            { tenantId, scope },
            { offset: nextOffset },
          )
        : undefined,
  };
}

export class MockExecutionPlanRepository implements ExecutionPlanRepository {
  private readonly plans = new Map<string, ExecutionPlanRecord>();

  async create(input: CreateExecutionPlanInput): Promise<ExecutionPlanRecord> {
    validateExecutionPlanShape(input);

    const key = planKey(input.tenantId, input.executionId);
    if (this.plans.has(key)) {
      throw new RepositoryAlreadyExistsError(
        `Execution plan ${input.executionId} already exists for tenant ${input.tenantId}.`,
      );
    }

    const now = new Date().toISOString();
    const record: ExecutionPlanRecord = {
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.plans.set(key, clone(record));
    return clone(record);
  }

  async getById(
    tenantId: string,
    executionId: string,
  ): Promise<ExecutionPlanRecord | undefined> {
    const record = this.plans.get(planKey(tenantId, executionId));
    return record ? clone(record) : undefined;
  }

  async update(
    tenantId: string,
    executionId: string,
    changes: UpdateExecutionPlanInput,
    options: UpdateOptions,
  ): Promise<ExecutionPlanRecord> {
    const key = planKey(tenantId, executionId);
    const existing = this.plans.get(key);

    if (!existing) {
      throw new RepositoryNotFoundError(
        `Execution plan ${executionId} was not found.`,
      );
    }

    if (existing.version !== options.expectedVersion) {
      throw new RepositoryConflictError(
        `Execution plan ${executionId} could not be updated because its version changed or it no longer exists.`,
      );
    }

    const merged: ExecutionPlanRecord = {
      ...existing,
      ...changes,
      tenantId: existing.tenantId,
      executionId: existing.executionId,
      workflowId: existing.workflowId,
      recommendationId: existing.recommendationId,
      createdBy: existing.createdBy,
      createdAt: existing.createdAt,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };

    validateExecutionPlanShape(merged);
    validateExecutionStartAllowed(
      merged.planStatus,
      merged.approvalRequired,
      merged.approvalStatus,
    );

    this.plans.set(key, clone(merged));
    return clone(merged);
  }

  async transitionStatus(
    tenantId: string,
    executionId: string,
    nextStatus: ExecutionPlanStatus,
    options: UpdateOptions,
  ): Promise<ExecutionPlanRecord> {
    const existing = await this.getById(tenantId, executionId);
    if (!existing) {
      throw new RepositoryNotFoundError(
        `Execution plan ${executionId} was not found.`,
      );
    }

    validateExecutionTransition(existing.planStatus, nextStatus, {
      approvalRequired: existing.approvalRequired,
      approvalStatus: existing.approvalStatus,
    });

    validateExecutionStartAllowed(
      nextStatus,
      existing.approvalRequired,
      existing.approvalStatus,
    );

    return this.update(
      tenantId,
      executionId,
      { planStatus: nextStatus },
      options,
    );
  }

  async recordApprovalDecision(
    tenantId: string,
    executionId: string,
    decision: ExecutionApprovalDecisionInput,
    options: UpdateOptions,
  ): Promise<ExecutionPlanRecord> {
    const existing = await this.getById(tenantId, executionId);
    if (!existing) {
      throw new RepositoryNotFoundError(
        `Execution plan ${executionId} was not found.`,
      );
    }

    if (!existing.approvalRequired) {
      throw new RepositoryConflictError(
        `Execution plan ${executionId} does not require approval.`,
      );
    }

    if (existing.planStatus !== 'PENDING_APPROVAL') {
      throw new RepositoryConflictError(
        `Execution plan ${executionId} is not awaiting approval.`,
      );
    }

    const decidedAt = decision.decidedAt ?? new Date().toISOString();
    const approvalChanges = approvalFieldsForDecision({
      decision: decision.decision,
      actorId: decision.actorId,
      decidedAt,
      rejectionReason: decision.rejectionReason,
    });

    return this.update(tenantId, executionId, approvalChanges, options);
  }

  async listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<ExecutionPlanRecord>> {
    const records = [...this.plans.values()]
      .filter((plan) => plan.tenantId === tenantId)
      .sort(byCreatedAtDescending);

    return paginateScoped(
      tenantId,
      EXECUTION_PAGINATION_SCOPES.tenantList(tenantId),
      records,
      page,
      clone,
    );
  }

  async listByWorkflow(
    tenantId: string,
    workflowId: string,
    page?: PageRequest,
  ): Promise<PageResult<ExecutionPlanRecord>> {
    const records = [...this.plans.values()]
      .filter(
        (plan) =>
          plan.tenantId === tenantId && plan.workflowId === workflowId,
      )
      .sort(byCreatedAtDescending);

    return paginateScoped(
      tenantId,
      EXECUTION_PAGINATION_SCOPES.workflowList(tenantId, workflowId),
      records,
      page,
      clone,
    );
  }

  async listByStatus(
    tenantId: string,
    status: ExecutionPlanStatus,
    page?: PageRequest,
  ): Promise<PageResult<ExecutionPlanRecord>> {
    const records = [...this.plans.values()]
      .filter(
        (plan) => plan.tenantId === tenantId && plan.planStatus === status,
      )
      .sort(byCreatedAtDescending);

    return paginateScoped(
      tenantId,
      EXECUTION_PAGINATION_SCOPES.statusList(tenantId, status),
      records,
      page,
      clone,
    );
  }
}
