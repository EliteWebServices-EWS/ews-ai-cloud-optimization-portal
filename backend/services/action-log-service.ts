import { prepareActionLogRecord } from '../action-log/record-builder';
import type {
  RecordActionLogEventInput,
  RecordActionLogEventResult,
} from '../action-log/types';
import type { ActionLogRepository } from '../repositories/contracts/action-log-repository';
import type { PageRequest, PageResult } from '../repositories/contracts/repository-types';
import type { ActionLogRecord } from '../action-log/types';

export class ActionLogService {
  constructor(private readonly repository: ActionLogRepository) {}

  async recordEvent(
    input: RecordActionLogEventInput,
  ): Promise<RecordActionLogEventResult> {
    return this.repository.recordEvent(input);
  }

  async getEvent(
    tenantId: string,
    logicalEventId: string,
  ): Promise<ActionLogRecord | null> {
    return this.repository.getEvent(tenantId, logicalEventId);
  }

  async reconstructDecisionLifecycle(
    tenantId: string,
    decisionId: string,
    page?: PageRequest,
  ): Promise<PageResult<ActionLogRecord>> {
    return this.repository.listByDecision(tenantId, decisionId, page);
  }

  async reconstructResourceLifecycle(
    tenantId: string,
    accountId: string,
    resourceId: string,
    page?: PageRequest,
  ): Promise<PageResult<ActionLogRecord>> {
    return this.repository.listByResource(
      tenantId,
      accountId,
      resourceId,
      page,
    );
  }

  async reconstructCorrelationLifecycle(
    tenantId: string,
    correlationId: string,
    page?: PageRequest,
  ): Promise<PageResult<ActionLogRecord>> {
    return this.repository.listByCorrelation(tenantId, correlationId, page);
  }

  async reconstructExecutionLifecycle(
    tenantId: string,
    executionId: string,
    page?: PageRequest,
  ): Promise<PageResult<ActionLogRecord>> {
    return this.repository.listByExecution(tenantId, executionId, page);
  }
}

export { prepareActionLogRecord };
