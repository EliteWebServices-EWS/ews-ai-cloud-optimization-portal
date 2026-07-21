import type { VerificationEngineInterface } from '../../shared/interfaces';
import type {
  Result,
  VerificationExpectation,
  VerificationRequest,
  VerificationResult,
} from '../../shared/types';
import { EXECUTION_STATUS } from '../../shared/constants';
import { AppError, createLogger } from '../../shared/utils';
import { compareVerificationOutcome } from './verification.comparator';
import { buildVerificationReport } from './verification.report';
import { DEFAULT_VERIFICATION_CONFIG, type VerificationConfig } from './verification.config';
import { requireValidVerificationInputs } from './verification.validator';
import { MockVerificationRepository } from './mock-verification.repository';
import type { VerificationRepository } from './verification.repository';

const logger = createLogger('VerificationEngine');

export interface VerificationEngineOptions {
  config?: VerificationConfig;
  repository?: VerificationRepository;
}

/**
 * Verification Engine — compares expected vs observed optimization outcomes.
 * Never executes changes or calls cloud providers.
 */
export class VerificationEngine implements VerificationEngineInterface {
  readonly name = 'Verification Engine';
  private readonly config: VerificationConfig;
  private readonly repository: VerificationRepository;

  constructor(options: VerificationEngineOptions = {}) {
    this.config = options.config ?? DEFAULT_VERIFICATION_CONFIG;
    this.repository = options.repository ?? new MockVerificationRepository();
  }

  async execute(request: VerificationRequest): Promise<Result<VerificationResult>> {
    const start = Date.now();
    logger.info('Verification started', {
      workflowId: request.context.workflowId,
      engine: this.name,
      operation: 'execute',
      executionId: request.executionResult.executionId,
    });

    try {
      if (!request.recommendation) {
        throw new AppError('INCOMPLETE_RECOMMENDATION', 'Recommendation decision is required', 400);
      }

      if (!request.financialImpact) {
        throw new AppError('MISSING_FINANCIAL_DATA', 'Financial impact is required', 400);
      }

      if (!request.observation) {
        throw new AppError('INVALID_OBSERVATION', 'Observation is required for verification', 400);
      }

      const expectation = this.buildExpectation(request);

      if (request.executionResult.status === EXECUTION_STATUS.COMPLETED) {
        requireValidVerificationInputs({
          executionResult: request.executionResult,
          observation: request.observation,
          expectation,
        });
      }

      const result = compareVerificationOutcome({
        executionResult: request.executionResult,
        observation: request.observation,
        expectation,
        config: this.config,
      });

      await this.repository.save({
        tenantId: request.context.tenantId,
        workflowId: request.context.workflowId,
        executionId: request.executionResult.executionId,
        expectation,
        observation: request.observation,
        result,
        recordedAt: new Date().toISOString(),
      });

      logger.info('Verification completed', {
        workflowId: request.context.workflowId,
        engine: this.name,
        durationMs: Date.now() - start,
        status: result.status,
        verifiedSavings: result.verifiedSavings,
      });

      logger.info('Outcome stored', {
        workflowId: request.context.workflowId,
        engine: this.name,
        operation: 'execute',
        status: result.status,
      });

      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown verification error';
      const code = error instanceof AppError ? error.code : 'VERIFICATION_FAILED';

      logger.error('Verification failed', {
        workflowId: request.context.workflowId,
        engine: this.name,
        durationMs: Date.now() - start,
        status: 'failed',
      });

      return {
        success: false,
        error: {
          engine: this.name,
          code,
          reason: message,
          recovery: 'Verify execution completed and observation data is complete',
        },
      };
    }
  }

  /** Build a verification report from a completed verification request. */
  buildReport(request: VerificationRequest, result: VerificationResult) {
    const expectation = this.buildExpectation(request);
    return buildVerificationReport({
      tenantId: request.context.tenantId,
      workflowId: request.context.workflowId,
      executionId: request.executionResult.executionId,
      expectation,
      observation: request.observation,
      result,
    });
  }

  /** Exposes the persistence boundary for API composition and adapter injection. */
  getRepository(): VerificationRepository {
    return this.repository;
  }

  private buildExpectation(request: VerificationRequest): VerificationExpectation {
    const expectedInstanceType =
      request.recommendation.detail.toInstanceType ??
      request.recommendation.action?.to ??
      request.observation.instanceType;

    return {
      expectedMonthlySavings: request.financialImpact.monthlySavings,
      expectedInstanceType,
      previousInstanceType:
        request.recommendation.detail.fromInstanceType ??
        request.recommendation.action?.from ??
        request.observation.previousInstanceType,
      currency: request.financialImpact.currency,
    };
  }
}

export function createVerificationEngine(
  options?: VerificationEngineOptions
): VerificationEngine {
  return new VerificationEngine(options);
}

export { compareVerificationOutcome } from './verification.comparator';
export { buildVerificationReport } from './verification.report';
export { DEFAULT_VERIFICATION_CONFIG } from './verification.config';
