import type {
  PageRequest,
  PageResult,
  UpdateOptions,
} from './repository-types';

import type {
  TenantRecord,
  TenantStatus,
} from '../models/persistence-models';

export type CreateTenantInput = Omit<
  TenantRecord,
  'version' | 'createdAt' | 'updatedAt'
>;

export type UpdateTenantInput = Partial<
  Omit<
    TenantRecord,
    | 'tenantId'
    | 'slug'
    | 'status'
    | 'version'
    | 'createdAt'
    | 'updatedAt'
  >
>;

export interface TenantRepository {
  create(input: CreateTenantInput): Promise<TenantRecord>;

  getById(
    tenantId: string,
  ): Promise<TenantRecord | undefined>;

  getBySlug(
    slug: string,
  ): Promise<TenantRecord | undefined>;

  update(
    tenantId: string,
    changes: UpdateTenantInput,
    options: UpdateOptions,
  ): Promise<TenantRecord>;

  transitionStatus(
    tenantId: string,
    nextStatus: TenantStatus,
    options: UpdateOptions,
  ): Promise<TenantRecord>;

  listByOwner(
    ownerUserId: string,
    page?: PageRequest,
  ): Promise<PageResult<TenantRecord>>;

  listByStatus(
    status: TenantStatus,
    page?: PageRequest,
  ): Promise<PageResult<TenantRecord>>;

  /**
   * List every tenant in the registry, platform-wide. Used only by
   * administration listing (Platform Admin) — never by tenant-scoped
   * callers, which must use listByOwner or a single getById instead.
   */
  listAll(
    page?: PageRequest,
  ): Promise<PageResult<TenantRecord>>;
}