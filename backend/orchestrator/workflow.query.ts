/**
 * Workflow list query parsing — tenant-scoped pagination for workflow APIs.
 */

import type { WorkflowState } from '../shared/constants';
import { WORKFLOW_STATES } from '../shared/constants';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../repositories/contracts/repository-types';

export const DEFAULT_WORKFLOW_LIST_LIMIT = DEFAULT_PAGE_SIZE;
export const MAX_WORKFLOW_LIST_LIMIT = MAX_PAGE_SIZE;

export interface WorkflowListQuery {
  limit: number;
  nextToken?: string;
  status?: WorkflowState;
}

export class WorkflowListQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowListQueryValidationError';
  }
}

const WORKFLOW_STATE_VALUES = new Set<string>(Object.values(WORKFLOW_STATES));

function isWorkflowState(value: string): value is WorkflowState {
  return WORKFLOW_STATE_VALUES.has(value);
}

/**
 * Parse and validate workflow list query-string parameters.
 */
export function parseWorkflowListQuery(
  query: Record<string, unknown>
): WorkflowListQuery {
  let limit = DEFAULT_WORKFLOW_LIST_LIMIT;
  if (typeof query.limit === 'string' && query.limit.length > 0) {
    const parsed = Number(query.limit);
    if (
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > MAX_WORKFLOW_LIST_LIMIT
    ) {
      throw new WorkflowListQueryValidationError(
        `limit must be an integer between 1 and ${MAX_WORKFLOW_LIST_LIMIT}`
      );
    }
    limit = parsed;
  }

  const nextToken =
    typeof query.nextToken === 'string' && query.nextToken.length > 0
      ? query.nextToken
      : undefined;

  let status: WorkflowState | undefined;
  if (typeof query.status === 'string' && query.status.length > 0) {
    const normalized = query.status.toLowerCase();
    if (!isWorkflowState(normalized)) {
      throw new WorkflowListQueryValidationError(
        `status must be one of: ${[...WORKFLOW_STATE_VALUES].join(', ')}`
      );
    }
    status = normalized;
  }

  return { limit, nextToken, status };
}

export interface WorkflowListPageRequest {
  limit?: number;
  nextToken?: string;
  status?: WorkflowState;
}

export interface WorkflowListPageResult<T> {
  items: T[];
  nextToken?: string;
}
