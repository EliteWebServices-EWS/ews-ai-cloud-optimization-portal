import type { ExecutionHistoryRecord } from '../models';
import type { PageRequest, PageResult } from './repository-types';

export type AppendExecutionHistoryInput = ExecutionHistoryRecord;

export interface ExecutionHistoryRepository {
  append(input: AppendExecutionHistoryInput): Promise<ExecutionHistoryRecord>;

  listByExecution(
    tenantId: string,
    executionId: string,
    page?: PageRequest,
  ): Promise<PageResult<ExecutionHistoryRecord>>;
}
