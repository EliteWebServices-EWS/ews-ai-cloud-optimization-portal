import type { ConfidenceEngineInterface } from '../../shared/interfaces';
import type { ConfidenceRequest, ConfidenceResult, Result } from '../../shared/types';
import { EVIDENCE_STATUS } from '../../shared/constants';
import { AppError, createLogger } from '../../shared/utils';
import { DEFAULT_CONFIDENCE_CONFIG, type ConfidenceConfig } from './confidence.config';
import { calculateConfidence } from './confidence.scoring';

const logger = createLogger('ConfidenceEngine');

export interface ConfidenceEngineOptions {
  config?: ConfidenceConfig;
}

/**
 * Confidence Intelligence — evaluates trust in optimization decisions.
 * Produces confidence scores separate from governance readiness.
 */
export class ConfidenceEngine implements ConfidenceEngineInterface {
  readonly name = 'Confidence Engine';
  private readonly config: ConfidenceConfig;

  constructor(options: ConfidenceEngineOptions = {}) {
    this.config = options.config ?? DEFAULT_CONFIDENCE_CONFIG;
  }

  async execute(request: ConfidenceRequest): Promise<Result<ConfidenceResult>> {
    const start = Date.now();
    logger.info('Confidence calculation started', {
      workflowId: request.context.workflowId,
      engine: this.name,
      operation: 'execute',
    });

    try {
      if (!request.evidence) {
        throw new AppError('INVALID_EVIDENCE', 'Evidence is required for confidence calculation', 400);
      }

      if (request.evidenceStatus === EVIDENCE_STATUS.INCOMPLETE) {
        return {
          success: false,
          error: {
            engine: this.name,
            code: 'INVALID_EVIDENCE',
            reason: 'Evidence status is incomplete — cannot calculate confidence',
            recovery: 'Complete evidence collection before confidence evaluation',
          },
        };
      }

      const result = calculateConfidence({
        evidence: request.evidence,
        validation: request.validation,
        resourceId: request.candidate.resourceId,
        config: this.config,
      });

      logger.info('Confidence complete', {
        workflowId: request.context.workflowId,
        engine: this.name,
        durationMs: Date.now() - start,
        status: result.status,
      });

      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown confidence error';
      const code = error instanceof AppError ? error.code : 'CONFIDENCE_CALCULATION_FAILED';

      logger.error('Confidence calculation failed', {
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
          recovery: 'Verify evidence completeness and metrics quality',
        },
      };
    }
  }
}

export function createConfidenceEngine(options?: ConfidenceEngineOptions): ConfidenceEngine {
  return new ConfidenceEngine(options);
}

export { calculateConfidence } from './confidence.scoring';
