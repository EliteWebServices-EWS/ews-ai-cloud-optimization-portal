import type {
  PageRequest,
  PageResult,
  UpdateOptions,
} from './repository-types';

import type {
  WorkflowRecord,
  WorkflowStatus,
} from '../models';

export type CreateWorkflowInput = Omit<
  WorkflowRecord,
  'version' | 'createdAt' | 'updatedAt'
>;

export type UpdateWorkflowInput = Partial<
  Omit<
    WorkflowRecord,
    | 'tenantId'
    | 'workflowId'
    | 'version'
    | 'createdAt'
    | 'updatedAt'
  >
>;

export interface WorkflowRepository {
  create(input: CreateWorkflowInput): Promise<WorkflowRecord>;

  get(
    tenantId: string,
    workflowId: string,
  ): Promise<WorkflowRecord | undefined>;

  update(
    tenantId: string,
    workflowId: string,
    changes: UpdateWorkflowInput,
    options: UpdateOptions,
  ): Promise<WorkflowRecord>;

  delete(
    tenantId: string,
    workflowId: string,
    options?: UpdateOptions,
  ): Promise<void>;

  listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<WorkflowRecord>>;

  listByStatus(
    tenantId: string,
    status: WorkflowStatus,
    page?: PageRequest,
  ): Promise<PageResult<WorkflowRecord>>;
}