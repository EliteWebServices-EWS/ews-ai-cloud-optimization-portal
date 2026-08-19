import { prepareActionLogRecord } from '../../action-log/record-builder';
import { compareActionLogRecords } from '../../action-log/event-ordering';
import type {
  ActionLogRecord,
  RecordActionLogEventInput,
  RecordActionLogEventResult,
} from '../../action-log/types';
import {
  decodeScopedNextToken,
  encodeScopedNextToken,
} from '../../persistence/scoped-pagination-token';
import { ACTION_LOG_PAGINATION_SCOPES } from '../../persistence/action-log-pagination-scopes';

import type {
  ActionLogRepository,
  PageRequest,
  PageResult,
} from '../contracts';

import { normalizePageSize } from '../contracts/repository-types';

function clone(record: ActionLogRecord): ActionLogRecord {
  return structuredClone(record);
}

function canonicalKey(tenantId: string, logicalEventId: string): string {
  return `${tenantId}#${logicalEventId}`;
}

function paginateSortedRecords(input: {
  tenantId: string;
  scope: string;
  records: ActionLogRecord[];
  page?: PageRequest;
}): PageResult<ActionLogRecord> {
  const limit = normalizePageSize(input.page?.limit);
  let offset = 0;

  if (input.page?.nextToken) {
    const key = decodeScopedNextToken(input.page.nextToken, {
      tenantId: input.tenantId,
      scope: input.scope,
    }) as { offset?: number } | undefined;
    offset = key?.offset ?? 0;
  }

  const items = input.records.slice(offset, offset + limit).map(clone);
  const nextOffset = offset + items.length;

  return {
    items,
    nextToken:
      nextOffset < input.records.length
        ? encodeScopedNextToken(
            { tenantId: input.tenantId, scope: input.scope },
            { offset: nextOffset },
          )
        : undefined,
  };
}

export class MockActionLogRepository implements ActionLogRepository {
  private readonly canonical = new Map<string, ActionLogRecord>();

  async recordEvent(
    input: RecordActionLogEventInput,
  ): Promise<RecordActionLogEventResult> {
    const record = prepareActionLogRecord(input);
    const key = canonicalKey(record.tenantId, record.logicalEventId);
    const existing = this.canonical.get(key);
    if (existing) {
      return { event: clone(existing), created: false };
    }

    this.canonical.set(key, clone(record));
    return { event: clone(record), created: true };
  }

  async getEvent(
    tenantId: string,
    logicalEventId: string,
  ): Promise<ActionLogRecord | null> {
    const record = this.canonical.get(canonicalKey(tenantId, logicalEventId));
    return record ? clone(record) : null;
  }

  async listByDecision(
    tenantId: string,
    decisionId: string,
    page?: PageRequest,
  ): Promise<PageResult<ActionLogRecord>> {
    const scope = ACTION_LOG_PAGINATION_SCOPES.decisionList(tenantId, decisionId);
    const records = [...this.canonical.values()]
      .filter(
        (record) =>
          record.tenantId === tenantId && record.decisionId === decisionId,
      )
      .sort(compareActionLogRecords);

    return paginateSortedRecords({ tenantId, scope, records, page });
  }

  async listByResource(
    tenantId: string,
    accountId: string,
    resourceId: string,
    page?: PageRequest,
  ): Promise<PageResult<ActionLogRecord>> {
    const scope = ACTION_LOG_PAGINATION_SCOPES.resourceList(
      tenantId,
      accountId,
      resourceId,
    );
    const records = [...this.canonical.values()]
      .filter(
        (record) =>
          record.tenantId === tenantId &&
          record.accountId === accountId &&
          record.resourceId === resourceId,
      )
      .sort(compareActionLogRecords);

    return paginateSortedRecords({ tenantId, scope, records, page });
  }

  async listByCorrelation(
    tenantId: string,
    correlationId: string,
    page?: PageRequest,
  ): Promise<PageResult<ActionLogRecord>> {
    const scope = ACTION_LOG_PAGINATION_SCOPES.correlationList(
      tenantId,
      correlationId,
    );
    const records = [...this.canonical.values()]
      .filter(
        (record) =>
          record.tenantId === tenantId &&
          record.correlationId === correlationId,
      )
      .sort(compareActionLogRecords);

    return paginateSortedRecords({ tenantId, scope, records, page });
  }

  async listByExecution(
    tenantId: string,
    executionId: string,
    page?: PageRequest,
  ): Promise<PageResult<ActionLogRecord>> {
    const scope = ACTION_LOG_PAGINATION_SCOPES.executionList(
      tenantId,
      executionId,
    );
    const records = [...this.canonical.values()]
      .filter(
        (record) =>
          record.tenantId === tenantId && record.executionId === executionId,
      )
      .sort(compareActionLogRecords);

    return paginateSortedRecords({ tenantId, scope, records, page });
  }
}
