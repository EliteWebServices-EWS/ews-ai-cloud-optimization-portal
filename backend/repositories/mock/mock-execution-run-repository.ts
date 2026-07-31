import {
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  RepositoryNotFoundError,
} from '../../database';

import type {
  CreateExecutionRunInput,
  ExecutionRunRepository,
  UpdateExecutionRunInput,
  UpdateOptions,
} from '../contracts';

import type { ExecutionRunRecord } from '../models/execution-run-models';

import {
  InvalidPaginationTokenError,
} from '../../database';
import {
  decodeScopedNextToken,
  encodeScopedNextToken,
} from '../../persistence/scoped-pagination-token';
import { EXECUTION_PAGINATION_SCOPES } from '../../persistence/execution-pagination-scopes';
import { normalizePageSize } from '../contracts/repository-types';
import type { PageRequest, PageResult } from '../contracts/repository-types';

function clone(record: ExecutionRunRecord): ExecutionRunRecord {
  return structuredClone(record);
}

function storeKey(tenantId: string, runId: string): string {
  return `${tenantId}#${runId}`;
}

export class MockExecutionRunRepository implements ExecutionRunRepository {
  private readonly store = new Map<string, ExecutionRunRecord>();

  async create(input: CreateExecutionRunInput): Promise<ExecutionRunRecord> {
    const id = storeKey(input.tenantId, input.runId);
    if (this.store.has(id)) {
      throw new RepositoryAlreadyExistsError(
        `Execution run ${input.runId} already exists.`,
      );
    }

    const now = new Date().toISOString();
    const record: ExecutionRunRecord = {
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(id, clone(record));
    return clone(record);
  }

  async getById(
    tenantId: string,
    runId: string,
  ): Promise<ExecutionRunRecord | undefined> {
    const record = this.store.get(storeKey(tenantId, runId));
    return record ? clone(record) : undefined;
  }

  async update(
    tenantId: string,
    runId: string,
    changes: UpdateExecutionRunInput,
    options: UpdateOptions,
  ): Promise<ExecutionRunRecord> {
    const id = storeKey(tenantId, runId);
    const existing = this.store.get(id);
    if (!existing) {
      throw new RepositoryNotFoundError(
        `Execution run ${runId} was not found.`,
      );
    }

    if (existing.version !== options.expectedVersion) {
      throw new RepositoryConflictError();
    }

    const updated: ExecutionRunRecord = {
      ...existing,
      ...changes,
      tenantId: existing.tenantId,
      runId: existing.runId,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };

    this.store.set(id, clone(updated));
    return clone(updated);
  }

  async listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<ExecutionRunRecord>> {
    const scope = EXECUTION_PAGINATION_SCOPES.runList(tenantId);
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

    const records = [...this.store.values()]
      .filter((run) => run.tenantId === tenantId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    const items = records.slice(offset, offset + limit).map(clone);
    const nextOffset = offset + items.length;

    return {
      items,
      nextToken:
        nextOffset < records.length
          ? encodeScopedNextToken({ tenantId, scope }, { offset: nextOffset })
          : undefined,
    };
  }
}
