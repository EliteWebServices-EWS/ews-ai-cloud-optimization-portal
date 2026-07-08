import type { RecommendationEngineInterface } from '../../shared/interfaces';
import type { RecommendationDecision, RecommendationRequest, Result } from '../../shared/types';
import { AppError, createLogger } from '../../shared/utils';
import { DEFAULT_RECOMMENDATION_CONFIG, type RecommendationConfig } from './recommendation.config';
import { deriveRecommendationDecision } from './recommendation.decision';

const logger = createLogger('RecommendationEngine');

export interface RecommendationEngineOptions {
  config?: RecommendationConfig;
}

/**
 * Recommendation Engine — combines evidence, governance, financial, and confidence
 * outputs into an optimization recommendation decision. Never calls providers.
 */
export class RecommendationEngine implements RecommendationEngineInterface {
  readonly name = 'Recommendation Engine';
  private readonly config: RecommendationConfig;

  constructor(options: RecommendationEngineOptions = {}) {
    this.config = options.config ?? DEFAULT_RECOMMENDATION_CONFIG;
  }

  async execute(request: RecommendationRequest): Promise<Result<RecommendationDecision>> {
    const start = Date.now();
    logger.info('Recommendation generation started', {
      workflowId: request.context.workflowId,
      engine: this.name,
      operation: 'execute',
    });

    try {
      if (!request.governance) {
        throw new AppError('MISSING_GOVERNANCE', 'Governance result is required', 400);
      }

      if (!request.financialImpact) {
        throw new AppError('MISSING_FINANCIAL_DATA', 'Financial impact is required', 400);
      }

      if (!request.confidence) {
        throw new AppError('CONFIDENCE_CALCULATION_FAILED', 'Confidence result is required', 400);
      }

      const decision = deriveRecommendationDecision({
        candidate: request.candidate,
        evidence: request.evidence,
        governance: request.governance,
        financialImpact: request.financialImpact,
        confidence: request.confidence,
        config: this.config,
      });

      logger.info('Recommendation generated', {
        workflowId: request.context.workflowId,
        engine: this.name,
        durationMs: Date.now() - start,
        status: decision.status,
      });

      logger.info('Recommendation returned', {
        workflowId: request.context.workflowId,
        engine: this.name,
        operation: 'execute',
        status: decision.status,
      });

      return { success: true, data: decision };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown recommendation error';
      const code = error instanceof AppError ? error.code : 'RECOMMENDATION_GENERATION_FAILED';

      logger.error('Recommendation generation failed', {
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
          recovery: 'Verify governance, financial, and confidence inputs',
        },
      };
    }
  }
}

export function createRecommendationEngine(
  options?: RecommendationEngineOptions
): RecommendationEngine {
  return new RecommendationEngine(options);
}

export { deriveRecommendationDecision } from './recommendation.decision';
