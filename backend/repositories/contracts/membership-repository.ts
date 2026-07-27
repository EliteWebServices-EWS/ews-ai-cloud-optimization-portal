import type { PageRequest, PageResult, UpdateOptions } from './repository-types';

import type { MembershipRecord } from '../models';

export type CreateMembershipInput = Omit<
  MembershipRecord,
  'version' | 'createdAt' | 'updatedAt'
>;

export type UpdateMembershipInput = Partial<
  Omit<
    MembershipRecord,
    | 'tenantId'
    | 'userId'
    | 'memberId'
    | 'version'
    | 'createdAt'
    | 'updatedAt'
    | 'joinedAt'
  >
>;

export interface MembershipRepository {
  create(input: CreateMembershipInput): Promise<MembershipRecord>;

  get(tenantId: string, userId: string): Promise<MembershipRecord | undefined>;

  /** Resolve a membership by its opaque memberId, independent of tenant. */
  getByMemberId(memberId: string): Promise<MembershipRecord | undefined>;

  update(
    tenantId: string,
    userId: string,
    changes: UpdateMembershipInput,
    options: UpdateOptions,
  ): Promise<MembershipRecord>;

  delete(tenantId: string, userId: string, options?: UpdateOptions): Promise<void>;

  listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<MembershipRecord>>;

  /** List every tenant membership held by a given user, across tenants. */
  listByUser(
    userId: string,
    page?: PageRequest,
  ): Promise<PageResult<MembershipRecord>>;
}
