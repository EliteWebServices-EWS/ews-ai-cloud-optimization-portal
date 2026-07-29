import {
  RepositoryAlreadyExistsError,
} from '../../database';
import {
  decodeScopedNextToken,
  encodeScopedNextToken,
} from '../../persistence/scoped-pagination-token';
import { EXECUTION_PAGINATION_SCOPES } from '../../persistence/execution-pagination-scopes';

import type {
  AppendExecutionHistoryInput,
  ExecutionHistoryRepository,
  PageRequest,
  PageResult,
} from '../contracts';

import { normalizePageSize } from '../contracts/repository-types';

import type { ExecutionHistoryRecord } from '../models';

import {
  validateAppendExecutionHistoryInput,
} from '../models/execution-persistence-models';

function clone(record: ExecutionHistoryRecord): ExecutionHistoryRecord {
  return structuredClone(record);
}

function historyKey(
  tenantId: string,
  executionId: string,
  historyId: string,
): string {
  return `${tenantId}#${executionId}#${historyId}`;
}

export class MockExecutionHistoryRepository
  implements ExecutionHistoryRepository
{
  private readonly history = new Map<string, ExecutionHistoryRecord>();

  async append(
    input: AppendExecutionHistoryInput,
  ): Promise<ExecutionHistoryRecord> {
    validateAppendExecutionHistoryInput(input);

    const key = historyKey(
      input.tenantId,
      input.executionId,
      input.historyId,
    );

    if (this.history.has(key)) {
      throw new RepositoryAlreadyExistsError(
        `Execution history ${input.historyId} already exists for execution ${input.executionId}.`,
      );
    }

    this.history.set(key, clone(input));
    return clone(input);
  }

  async listByExecution(
    tenantId: string,
    executionId: string,
    page?: PageRequest,
  ): Promise<PageResult<ExecutionHistoryRecord>> {
    const scope = EXECUTION_PAGINATION_SCOPES.historyList(
      tenantId,
      executionId,
    );
    const limit = normalizePageSize(page?.limit);

    let offset = 0;
    if (page?.nextToken) {
      const key = decodeScopedNextToken(page.nextToken, {
        tenantId,
        scope,
      }) as { offset?: number } | undefined;
      offset = key?.offset ?? 0;
    }

    const records = [...this.history.values()]
      .filter(
        (entry) =>
          entry.tenantId === tenantId &&
          entry.executionId === executionId,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    const items = records.slice(offset, offset + limit).map(clone);
    const nextOffset = offset + items.length;

    return {
      items,
      nextToken:
        nextOffset < records.length
          ? encodeScopedNextToken(
              { tenantId, scope },
              { offset: nextOffset },
            )
          : undefined,
    };
  }
}
