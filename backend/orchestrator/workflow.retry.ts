/**
 * Retry-ready workflow architecture — tracks attempts without distributed queues.
 * Sprint 7: supports retry count, status, and failed attempts for future retry policy.
 */

import type { WorkflowExecutionState, WorkflowStage } from '../shared/constants';
import type { EngineError } from '../shared/types';
import { WORKFLOW_MAX_RETRIES } from '../shared/constants';
import type { WorkflowFailureAttempt, WorkflowRetryState } from './workflow.types';

/** Create initial retry state for a new workflow. */
export function createRetryState(maxRetries = WORKFLOW_MAX_RETRIES): WorkflowRetryState {
  return {
    maxRetries,
    attemptCount: 0,
    status: 'none',
    failedAttempts: [],
  };
}

/** Record a failed attempt and update retry status. */
export function recordFailedAttempt(
  retry: WorkflowRetryState,
  stage: WorkflowStage,
  executionState: WorkflowExecutionState,
  error: EngineError
): WorkflowRetryState {
  const attemptNumber = retry.attemptCount + 1;
  const attempt: WorkflowFailureAttempt = {
    stage,
    executionState,
    error,
    attemptNumber,
    timestamp: new Date().toISOString(),
  };

  const failedAttempts = [...retry.failedAttempts, attempt];
  const exhausted = attemptNumber >= retry.maxRetries;

  return {
    ...retry,
    attemptCount: attemptNumber,
    status: exhausted ? 'exhausted' : 'retryable',
    failedAttempts,
  };
}

/** Determine whether a workflow stage failure is eligible for future retry. */
export function canRetry(retry: WorkflowRetryState): boolean {
  return retry.status === 'retryable' && retry.attemptCount < retry.maxRetries;
}
