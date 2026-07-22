import type {
  PageRequest,
  PageResult,
  UpdateOptions,
} from './repository-types';

import type { VerificationRecord } from '../models';

export type CreateVerificationInput = Omit<
  VerificationRecord,
  'version' | 'createdAt' | 'updatedAt'
>;

export type UpdateVerificationInput = Partial<
  Omit<
    VerificationRecord,
    | 'tenantId'
    | 'verificationId'
    | 'version'
    | 'createdAt'
    | 'updatedAt'
  >
>;

export interface VerificationRepository {
  create(
    input: CreateVerificationInput,
  ): Promise<VerificationRecord>;

  get(
    tenantId: string,
    verificationId: string,
  ): Promise<VerificationRecord | undefined>;

  update(
    tenantId: string,
    verificationId: string,
    changes: UpdateVerificationInput,
    options: UpdateOptions,
  ): Promise<VerificationRecord>;

  delete(
    tenantId: string,
    verificationId: string,
    options?: UpdateOptions,
  ): Promise<void>;

  listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<VerificationRecord>>;

  listByWorkflow(
    tenantId: string,
    workflowId: string,
    page?: PageRequest,
  ): Promise<PageResult<VerificationRecord>>;
}