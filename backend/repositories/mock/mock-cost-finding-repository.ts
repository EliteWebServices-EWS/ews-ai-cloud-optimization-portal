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
import { COST_FINDING_PAGINATION_SCOPES } from '../../persistence/cost-finding-pagination-scopes';

import type {
  CostFindingRepository,
  CreateCostFindingInput,
  PageRequest,
  PageResult,
  UpdateCostFindingInput,
  UpdateOptions,
} from '../contracts';
import { normalizePageSize } from '../contracts/repository-types';

import type { CostFindingRecord } from '../models';
import { validateCostFindingShape } from '../models/cost-finding-persistence-models';

function clone(record: CostFindingRecord): CostFindingRecord {
  return structuredClone(record);
}

function recordKey(tenantId: string, findingId: string): string {
  return `${tenantId}#${findingId}`;
}

function byCreatedAtDescending(
  left: CostFindingRecord,
  right: CostFindingRecord,
): number {
  const compare = right.createdAt.localeCompare(left.createdAt);
  if (compare !== 0) {
    return compare;
  }
  return right.findingId.localeCompare(left.findingId);
}

function paginate(
  tenantId: string,
  scope: string,
  records: CostFindingRecord[],
  page: PageRequest | undefined,
): PageResult<CostFindingRecord> {
  const limit = normalizePageSize(page?.limit);
  let offset = 0;

  if (page?.nextToken) {
    try {
      const key = decodeScopedNextToken(page.nextToken, { tenantId, scope }) as
        | { offset?: number }
        | undefined;
      offset = key?.offset ?? 0;
    } catch {
      throw new InvalidPaginationTokenError();
    }
  }

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

export class MockCostFindingRepository implements CostFindingRepository {
  private readonly records = new Map<string, CostFindingRecord>();

  async create(input: CreateCostFindingInput): Promise<CostFindingRecord> {
    validateCostFindingShape(input);

    const key = recordKey(input.tenantId, input.findingId);
    if (this.records.has(key)) {
      throw new RepositoryAlreadyExistsError(
        `Cost finding ${input.findingId} already exists.`,
      );
    }

    const now = new Date().toISOString();
    const record: CostFindingRecord = {
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.records.set(key, clone(record));
    return clone(record);
  }

  async get(
    tenantId: string,
    findingId: string,
  ): Promise<CostFindingRecord | undefined> {
    const record = this.records.get(recordKey(tenantId, findingId));
    return record ? clone(record) : undefined;
  }

  async update(
    tenantId: string,
    findingId: string,
    changes: UpdateCostFindingInput,
    options: UpdateOptions,
  ): Promise<CostFindingRecord> {
    const key = recordKey(tenantId, findingId);
    const existing = this.records.get(key);

    if (!existing) {
      throw new RepositoryNotFoundError(`Cost finding ${findingId} was not found.`);
    }

    if (existing.version !== options.expectedVersion) {
      throw new RepositoryConflictError(
        `Cost finding ${findingId} could not be updated because its version changed or it no longer exists.`,
      );
    }

    const merged: CostFindingRecord = {
      ...existing,
      ...changes,
      tenantId: existing.tenantId,
      findingId: existing.findingId,
      createdAt: existing.createdAt,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };

    this.records.set(key, clone(merged));
    return clone(merged);
  }

  async listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<CostFindingRecord>> {
    const scope = COST_FINDING_PAGINATION_SCOPES.tenantList(tenantId);
    const records = [...this.records.values()]
      .filter((record) => record.tenantId === tenantId)
      .sort(byCreatedAtDescending);

    return paginate(tenantId, scope, records, page);
  }

  async listByAccount(
    tenantId: string,
    accountId: string,
    page?: PageRequest,
  ): Promise<PageResult<CostFindingRecord>> {
    const scope = COST_FINDING_PAGINATION_SCOPES.accountList(tenantId, accountId);
    const records = [...this.records.values()]
      .filter(
        (record) => record.tenantId === tenantId && record.accountId === accountId,
      )
      .sort(byCreatedAtDescending);

    return paginate(tenantId, scope, records, page);
  }

  async listByAnalysis(
    tenantId: string,
    analysisId: string,
  ): Promise<CostFindingRecord[]> {
    return [...this.records.values()]
      .filter(
        (record) => record.tenantId === tenantId && record.analysisId === analysisId,
      )
      .sort(byCreatedAtDescending)
      .map(clone);
  }
}
