import type { ExecutionRequest, ExecutionResult } from '../shared/types';
import { EXECUTION_STATUS, RECOMMENDATION_STATUS } from '../shared/constants';
import { AppError, createLogger, generateExecutionId } from '../shared/utils';
import {
  DEFAULT_EXECUTION_CONFIG,
  type ExecutionSimulatorConfig,
} from './execution.config';

const logger = createLogger('ExecutionSimulator');

export interface ExecutionSimulatorInterface {
  readonly name: string;
  simulate(request: ExecutionRequest): Promise<ExecutionResult>;
}

export interface ExecutionSimulatorOptions {
  config?: ExecutionSimulatorConfig;
}

/**
 * Mock execution layer — simulates applying an optimization without touching AWS.
 * Returns deterministic before/after state for downstream verification.
 */
export class ExecutionSimulator implements ExecutionSimulatorInterface {
  readonly name = 'Execution Simulator';
  private readonly config: ExecutionSimulatorConfig;

  constructor(options: ExecutionSimulatorOptions = {}) {
    this.config = options.config ?? DEFAULT_EXECUTION_CONFIG;
  }

  async simulate(request: ExecutionRequest): Promise<ExecutionResult> {
    const start = Date.now();
    const executionId = generateExecutionId();
    const action = request.recommendation.action;
    const recommendationStatus = request.recommendation.status;

    logger.info('Execution started', {
      workflowId: request.context.workflowId,
      operation: 'simulate',
      recommendationStatus,
      executionId,
    });

    if (!action?.from || !action.to) {
      logger.error('Execution failed — missing optimization action', {
        workflowId: request.context.workflowId,
        executionId,
      });

      return this.buildResult({
        executionId,
        request,
        status: EXECUTION_STATUS.FAILED,
        success: false,
        message: 'Execution failed — recommendation action is incomplete',
        previousInstanceType: request.candidate.metadata?.instanceType as string | undefined,
        newInstanceType: request.candidate.metadata?.instanceType as string | undefined,
      });
    }

    if (!this.config.executableStatuses.includes(recommendationStatus)) {
      const message =
        recommendationStatus === RECOMMENDATION_STATUS.DEFERRED
          ? 'Execution skipped — recommendation deferred pending approval'
          : `Execution skipped — recommendation status is ${recommendationStatus}`;

      logger.info('Execution skipped', {
        workflowId: request.context.workflowId,
        executionId,
        recommendationStatus,
      });

      return this.buildResult({
        executionId,
        request,
        status: EXECUTION_STATUS.SKIPPED,
        success: false,
        message,
        previousInstanceType: action.from,
        newInstanceType: action.from,
      });
    }

    if (action.from === action.to) {
      throw new AppError(
        'INVALID_EXECUTION',
        'Cannot simulate execution — source and target instance types are identical',
        400
      );
    }

    logger.info('Execution completed', {
      workflowId: request.context.workflowId,
      executionId,
      durationMs: Date.now() - start,
      status: EXECUTION_STATUS.COMPLETED,
    });

    return this.buildResult({
      executionId,
      request,
      status: EXECUTION_STATUS.COMPLETED,
      success: true,
      message: `Simulated ${action.action} from ${action.from} to ${action.to}`,
      previousInstanceType: action.from,
      newInstanceType: action.to,
    });
  }

  private buildResult(input: {
    executionId: string;
    request: ExecutionRequest;
    status: ExecutionResult['status'];
    success: boolean;
    message: string;
    previousInstanceType?: string;
    newInstanceType?: string;
  }): ExecutionResult {
    const action = input.request.recommendation.action;
    const previousType = input.previousInstanceType ?? action?.from ?? 'unknown';
    const newType = input.newInstanceType ?? action?.to ?? previousType;
    const executedAt = new Date().toISOString();

    const previousState = {
      instanceType: previousType,
      resourceId: input.request.candidate.resourceId,
      region: input.request.candidate.region,
      state: 'running',
    };

    const newState = {
      instanceType: newType,
      resourceId: input.request.candidate.resourceId,
      region: input.request.candidate.region,
      state: 'running',
    };

    return {
      executionId: input.executionId,
      status: input.status,
      resourceId: input.request.candidate.resourceId,
      resourceType: input.request.candidate.resourceType,
      action: action?.action ?? 'none',
      success: input.success,
      executedAt,
      change: {
        action: action?.action ?? 'none',
        from: previousType,
        to: newType,
        resourceType: input.request.candidate.resourceType,
      },
      previousState,
      newState,
      beforeState: previousState,
      afterState: newState,
      metadata: {
        tenantId: input.request.context.tenantId,
        workflowId: input.request.context.workflowId,
        plugin: input.request.context.plugin,
        region: input.request.candidate.region,
        simulated: true,
        recommendationStatus: input.request.recommendation.status,
      },
      message: input.message,
    };
  }
}

export function createExecutionSimulator(
  options?: ExecutionSimulatorOptions
): ExecutionSimulator {
  return new ExecutionSimulator(options);
}
