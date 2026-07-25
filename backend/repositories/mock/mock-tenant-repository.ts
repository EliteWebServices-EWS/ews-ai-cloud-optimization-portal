/**
 * In-memory TenantRepository implementation for local development and unit
 * tests — no AWS dependency, same tenant-isolation and optimistic-locking
 * behavior as DynamoDbTenantRepository.
 */

import {
  decodeNextToken,
  encodeNextToken,
  normalizeTenantSlug,
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  RepositoryNotFoundError,
} from '../../database';
import { validateTenantTransition } from '../../services/tenant-lifecycle';
import type {
  CreateTenantInput,
  PageRequest,
  PageResult,
  TenantRepository,
  UpdateOptions,
  UpdateTenantInput,
} from '../contracts';
import { normalizePageSize } from '../contracts/repository-types';
import type { TenantRecord, TenantStatus } from '../models';

function clone(record: TenantRecord): TenantRecord {
  return structuredClone(record);
}

function byCreatedAtDescending(
  left: TenantRecord,
  right: TenantRecord
): number {
  return (
    new Date(right.createdAt).getTime() -
    new Date(left.createdAt).getTime()
  );
}

function paginate(
  records: TenantRecord[],
  page?: PageRequest
): PageResult<TenantRecord> {
  const limit = normalizePageSize(page?.limit);
  const offsetKey = decodeNextToken(page?.nextToken) as
    | { offset: number }
    | undefined;
  const offset = offsetKey?.offset ?? 0;

  const items = records.slice(offset, offset + limit).map(clone);
  const nextOffset = offset + items.length;

  return {
    items,
    nextToken:
      nextOffset < records.length
        ? encodeNextToken({ offset: nextOffset })
        : undefined,
  };
}

export class MockTenantRepository implements TenantRepository {
  private readonly tenantsById = new Map<string, TenantRecord>();
  private readonly tenantIdBySlug = new Map<string, string>();

  async create(input: CreateTenantInput): Promise<TenantRecord> {
    const normalizedSlug = normalizeTenantSlug(input.slug);

    if (
      this.tenantsById.has(input.tenantId) ||
      this.tenantIdBySlug.has(normalizedSlug)
    ) {
      throw new RepositoryAlreadyExistsError(
        `Tenant ${input.tenantId} or slug ${normalizedSlug} already exists.`
      );
    }

    const now = new Date().toISOString();
    const record: TenantRecord = {
      ...input,
      slug: normalizedSlug,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.tenantsById.set(record.tenantId, record);
    this.tenantIdBySlug.set(normalizedSlug, record.tenantId);

    return clone(record);
  }

  async getById(tenantId: string): Promise<TenantRecord | undefined> {
    const record = this.tenantsById.get(tenantId);
    return record ? clone(record) : undefined;
  }

  async getBySlug(slug: string): Promise<TenantRecord | undefined> {
    const tenantId = this.tenantIdBySlug.get(normalizeTenantSlug(slug));
    return tenantId ? this.getById(tenantId) : undefined;
  }

  async update(
    tenantId: string,
    changes: UpdateTenantInput,
    options: UpdateOptions
  ): Promise<TenantRecord> {
    const current = this.tenantsById.get(tenantId);

    if (!current) {
      throw new RepositoryNotFoundError(
        `Tenant ${tenantId} was not found.`
      );
    }

    if (current.version !== options.expectedVersion) {
      throw new RepositoryConflictError(
        `Tenant ${tenantId} could not be updated because its version changed or it no longer exists.`
      );
    }

    const updated: TenantRecord = {
      ...current,
      ...changes,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };

    this.tenantsById.set(tenantId, updated);

    return clone(updated);
  }

  async transitionStatus(
    tenantId: string,
    nextStatus: TenantStatus,
    options: UpdateOptions
  ): Promise<TenantRecord> {
    const current = this.tenantsById.get(tenantId);

    if (!current) {
      throw new RepositoryNotFoundError(
        `Tenant ${tenantId} was not found.`
      );
    }

    validateTenantTransition(current.status, nextStatus);

    if (current.version !== options.expectedVersion) {
      throw new RepositoryConflictError(
        `Tenant ${tenantId} could not change status because its version changed or it no longer exists.`
      );
    }

    const updated: TenantRecord = {
      ...current,
      status: nextStatus,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };

    this.tenantsById.set(tenantId, updated);

    return clone(updated);
  }

  async listByOwner(
    ownerUserId: string,
    page?: PageRequest
  ): Promise<PageResult<TenantRecord>> {
    const records = Array.from(this.tenantsById.values())
      .filter((record) => record.ownerUserId === ownerUserId)
      .sort(byCreatedAtDescending);

    return paginate(records, page);
  }

  async listByStatus(
    status: TenantStatus,
    page?: PageRequest
  ): Promise<PageResult<TenantRecord>> {
    const records = Array.from(this.tenantsById.values())
      .filter((record) => record.status === status)
      .sort(byCreatedAtDescending);

    return paginate(records, page);
  }

  async listAll(page?: PageRequest): Promise<PageResult<TenantRecord>> {
    const records = Array.from(this.tenantsById.values()).sort(
      byCreatedAtDescending
    );

    return paginate(records, page);
  }
}
