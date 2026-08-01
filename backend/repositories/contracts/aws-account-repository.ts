import type {
  AwsAccountRecord,
  AwsAccountStatus,
} from '../models/aws-account-persistence-models';

import type {
  PageRequest,
  PageResult,
  UpdateOptions,
} from './repository-types';

export type CreateAwsAccountInput = Omit<
  AwsAccountRecord,
  'version' | 'createdAt' | 'updatedAt'
>;

export type UpdateAwsAccountPatch = Partial<
  Omit<
    AwsAccountRecord,
    | 'accountId'
    | 'tenantId'
    | 'version'
    | 'createdAt'
    | 'updatedAt'
  >
>;

export type AwsAccountTransitionFields = Partial<
  Pick<
    AwsAccountRecord,
    | 'verificationStatus'
    | 'lastValidated'
    | 'metadata'
    | 'roleArn'
    | 'externalId'
    | 'region'
  >
>;

/**
 * Resolves a registered AWS account by 12-digit account ID.
 *
 * **Platform / internal use only.** AWS account IDs are globally unique in
 * SISU'M (Option A). At most one active registration exists; callers must not
 * expose cross-tenant ownership to ordinary tenant-scoped API handlers.
 */
export interface AwsAccountRepository {
  create(input: CreateAwsAccountInput): Promise<AwsAccountRecord>;

  getById(
    tenantId: string,
    accountId: string,
  ): Promise<AwsAccountRecord | undefined>;

  /**
   * Global lookup by AWS account ID (internal / platform-admin flows).
   */
  getByAccountId(accountId: string): Promise<AwsAccountRecord | undefined>;

  update(
    tenantId: string,
    accountId: string,
    patch: UpdateAwsAccountPatch,
    options: UpdateOptions,
  ): Promise<AwsAccountRecord>;

  transitionStatus(
    tenantId: string,
    accountId: string,
    nextStatus: AwsAccountStatus,
    options: UpdateOptions,
    fields?: AwsAccountTransitionFields,
  ): Promise<AwsAccountRecord>;

  listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<AwsAccountRecord>>;

  listByStatus(
    tenantId: string,
    status: AwsAccountStatus,
    page?: PageRequest,
  ): Promise<PageResult<AwsAccountRecord>>;
}
