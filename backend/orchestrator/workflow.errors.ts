/**
 * Workflow-specific error types for stage failures and graceful termination.
 */

import type { WorkflowExecutionState, WorkflowStage } from '../shared/constants';
import type { EngineError } from '../shared/types';
import { AppError } from '../shared/utils';

/** Error raised when a workflow stage fails during orchestration. */
export class WorkflowStageError extends AppError {
  constructor(
    public readonly failedStage: WorkflowStage,
    public readonly executionState: WorkflowExecutionState,
    public readonly engineError: EngineError,
    statusCode = 500
  ) {
    super(engineError.code, engineError.reason, statusCode, failedStage);
    this.name = 'WorkflowStageError';
  }
}

/** Error raised when workflow input validation fails before stage execution. */
export class WorkflowValidationError extends AppError {
  constructor(
    message: string,
    public readonly executionState: WorkflowExecutionState,
    stage?: WorkflowStage
  ) {
    super('WORKFLOW_VALIDATION_ERROR', message, 422, stage);
    this.name = 'WorkflowValidationError';
  }
}

export function isWorkflowStageError(error: unknown): error is WorkflowStageError {
  return error instanceof WorkflowStageError;
}

/** Convert any error into a structured EngineError for workflow failure reporting. */
export function toEngineError(
  error: unknown,
  engine: string,
  code = 'WORKFLOW_FAILED'
): EngineError {
  if (error instanceof WorkflowStageError) {
    return error.engineError;
  }
  if (error instanceof AppError) {
    return error.toEngineError(engine);
  }
  const reason = error instanceof Error ? error.message : String(error);
  return { engine, code, reason };
}
