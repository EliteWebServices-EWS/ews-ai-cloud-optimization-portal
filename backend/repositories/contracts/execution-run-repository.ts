import type { ExecutionRunRecord } from '../models/execution-run-models';
import type { PageRequest, PageResult, UpdateOptions } from './repository-types';

export type CreateExecutionRunInput = Omit<
  ExecutionRunRecord,
  'version' | 'createdAt' | 'updatedAt'
>;

export type UpdateExecutionRunInput = Partial<
  Omit<
    ExecutionRunRecord,
    | 'tenantId'
    | 'runId'
    | 'correlationId'
    | 'requestId'
    | 'actorId'
    | 'service'
    | 'action'
    | 'resourceId'
    | 'region'
    | 'mode'
    | 'version'
    | 'createdAt'
    | 'updatedAt'
  >
>;

export interface ExecutionRunRepository {
  create(input: CreateExecutionRunInput): Promise<ExecutionRunRecord>;

  getById(
    tenantId: string,
    runId: string,
  ): Promise<ExecutionRunRecord | undefined>;

  update(
    tenantId: string,
    runId: string,
    changes: UpdateExecutionRunInput,
    options: UpdateOptions,
  ): Promise<ExecutionRunRecord>;

  listByTenant(
    tenantId: string,
    page?: PageRequest,
  ): Promise<PageResult<ExecutionRunRecord>>;
}
