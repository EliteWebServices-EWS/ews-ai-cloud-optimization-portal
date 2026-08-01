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
import { AWS_ACCOUNT_PAGINATION_SCOPES } from '../../persistence/aws-account-pagination-scopes';

import type {
  AwsAccountRepository,
  AwsAccountTransitionFields,
  CreateAwsAccountInput,
  PageRequest,
  PageResult,
  UpdateAwsAccountPatch,
  UpdateOptions,
} from '../contracts';

import { normalizePageSize } from '../contracts/repository-types';

import type { AwsAccountRecord, AwsAccountStatus } from '../models';

import { validateAwsAccountShape } from '../models/aws-account-persistence-models';

import {
  validateAwsAccountStatusConsistency,
  validateAwsAccountTransition,
  verificationFieldsForValidationFailure,
  verificationFieldsForValidationStart,
  verificationFieldsForValidationSuccess,
} from '../../services/aws-account-lifecycle';

function clone(record: AwsAccountRecord): AwsAccountRecord {
  return structuredClone(record);
}

function recordKey(tenantId: string, accountId: string): string {
  return `${tenantId}#${accountId}`;
}

function byUpdatedAtDescending(
  left: AwsAccountRecord,
  right: AwsAccountRecord,
): number {
  const updatedCompare = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedCompare !== 0) {
    return updatedCompare;
  }
  return right.accountId.localeCompare(left.accountId);
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
        ? encodeScopedNextToken({ tenantId, scope }, { offset: nextOffset })
        : undefined,
  };
}

function transitionVerificationPatch(
  existing: AwsAccountRecord,
  nextStatus: AwsAccountStatus,
  fields?: AwsAccountTransitionFields,
): AwsAccountTransitionFields {
  if (fields?.verificationStatus !== undefined) {
    return fields;
  }

  if (nextStatus === 'VALIDATING') {
    return { ...fields, ...verificationFieldsForValidationStart() };
  }

  if (nextStatus === 'VERIFIED') {
    return {
      ...fields,
      ...verificationFieldsForValidationSuccess(new Date().toISOString()),
    };
  }

  if (nextStatus === 'PENDING' && existing.status === 'VALIDATING') {
    return {
      ...fields,
      ...verificationFieldsForValidationFailure(new Date().toISOString()),
    };
  }

  return fields ?? {};
}

export class MockAwsAccountRepository implements AwsAccountRepository {
  private readonly records = new Map<string, AwsAccountRecord>();

  /** Global uniqueness lock: accountId -> tenantId */
  private readonly accountLocks = new Map<string, string>();

  async create(input: CreateAwsAccountInput): Promise<AwsAccountRecord> {
    validateAwsAccountShape(input);
    validateAwsAccountStatusConsistency({
      status: input.status,
      verificationStatus: input.verificationStatus,
      lastValidated: input.lastValidated,
    });

    const key = recordKey(input.tenantId, input.accountId);
    if (this.records.has(key)) {
      throw new RepositoryAlreadyExistsError(
        `AWS account ${input.accountId} already exists for tenant ${input.tenantId}.`,
      );
    }

    const lockOwner = this.accountLocks.get(input.accountId);
    if (lockOwner && lockOwner !== input.tenantId) {
      throw new RepositoryAlreadyExistsError(
        `AWS account ${input.accountId} is already registered to another tenant.`,
      );
    }

    const now = new Date().toISOString();
    const record: AwsAccountRecord = {
      ...input,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.records.set(key, clone(record));
    this.accountLocks.set(input.accountId, input.tenantId);
    return clone(record);
  }

  async getById(
    tenantId: string,
    accountId: string,
  ): Promise<AwsAccountRecord | undefined> {
    const record = this.records.get(recordKey(tenantId, accountId));
    return record ? clone(record) : undefined;
  }

  async getByAccountId(
    accountId: string,
  ): Promise<AwsAccountRecord | undefined> {
    const tenantId = this.accountLocks.get(accountId.trim());
    if (!tenantId) {
      return undefined;
    }

    return this.getById(tenantId, accountId);
  }

  async update(
    tenantId: string,
    accountId: string,
    patch: UpdateAwsAccountPatch,
    options: UpdateOptions,
  ): Promise<AwsAccountRecord> {
    const key = recordKey(tenantId, accountId);
    const existing = this.records.get(key);

    if (!existing) {
      throw new RepositoryNotFoundError(
        `AWS account ${accountId} was not found.`,
      );
    }

    if (existing.version !== options.expectedVersion) {
      throw new RepositoryConflictError(
        `AWS account ${accountId} could not be updated because its version changed or it no longer exists.`,
      );
    }

    const merged: AwsAccountRecord = {
      ...existing,
      ...patch,
      accountId: existing.accountId,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };

    validateAwsAccountShape(merged);
    validateAwsAccountStatusConsistency({
      status: merged.status,
      verificationStatus: merged.verificationStatus,
      lastValidated: merged.lastValidated,
    });

    this.records.set(key, clone(merged));
    return clone(merged);
  }

  async transitionStatus(
    tenantId: string,
    accountId: string,
    nextStatus: AwsAccountStatus,
    options: UpdateOptions,
    fields?: AwsAccountTransitionFields,
  ): Promise<AwsAccountRecord> {
    const existing = await this.getById(tenantId, accountId);
    if (!existing) {
      throw new RepositoryNotFoundError(
        `AWS account ${accountId} was not found.`,
      );
    }

    validateAwsAccountTransition(existing.status, nextStatus);

    const verificationPatch = transitionVerificationPatch(
      existing,
      nextStatus,
      fields,
    );

    const merged: AwsAccountRecord = {
      ...existing,
      ...verificationPatch,
      status: nextStatus,
    };

    validateAwsAccountStatusConsistency({
      status: merged.status,
      verificationStatus: merged.verificationStatus,
      lastValidated: merged.lastValidated,
    });

    return this.update(
      tenantId,
      accountId,
      {
        status: nextStatus,
        ...verificationPatch,
      },
      options,
    );
  }

  async listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<AwsAccountRecord>> {
    const scope = AWS_ACCOUNT_PAGINATION_SCOPES.tenantList(tenantId);
    const records = [...this.records.values()]
      .filter((record) => record.tenantId === tenantId)
      .sort(byUpdatedAtDescending);

    return paginateScoped(tenantId, scope, records, page, clone);
  }

  async listByStatus(
    tenantId: string,
    status: AwsAccountStatus,
    page?: PageRequest,
  ): Promise<PageResult<AwsAccountRecord>> {
    const scope = AWS_ACCOUNT_PAGINATION_SCOPES.statusList(tenantId, status);
    const records = [...this.records.values()]
      .filter(
        (record) => record.tenantId === tenantId && record.status === status,
      )
      .sort(byUpdatedAtDescending);

    return paginateScoped(tenantId, scope, records, page, clone);
  }
}
