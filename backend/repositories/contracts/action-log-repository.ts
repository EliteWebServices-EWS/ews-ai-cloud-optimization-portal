import type {
  ActionLogRecord,
  RecordActionLogEventInput,
  RecordActionLogEventResult,
} from '../../action-log/types';

import type { PageRequest, PageResult } from './repository-types';

export interface ActionLogRepository {
  recordEvent(input: RecordActionLogEventInput): Promise<RecordActionLogEventResult>;
  getEvent(tenantId: string, logicalEventId: string): Promise<ActionLogRecord | null>;
  listByDecision(
    tenantId: string,
    decisionId: string,
    page?: PageRequest,
  ): Promise<PageResult<ActionLogRecord>>;
  listByResource(
    tenantId: string,
    accountId: string,
    resourceId: string,
    page?: PageRequest,
  ): Promise<PageResult<ActionLogRecord>>;
  listByCorrelation(
    tenantId: string,
    correlationId: string,
    page?: PageRequest,
  ): Promise<PageResult<ActionLogRecord>>;
  listByExecution(
    tenantId: string,
    executionId: string,
    page?: PageRequest,
  ): Promise<PageResult<ActionLogRecord>>;
}
