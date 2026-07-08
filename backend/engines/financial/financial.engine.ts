import type { ProviderInterface } from '../../shared/interfaces';
import type { FinancialEngineInterface } from '../../shared/interfaces';
import type { FinancialImpact, FinancialRequest, Result } from '../../shared/types';
import { GOVERNANCE_STATUS } from '../../shared/constants';
import { AppError, createLogger } from '../../shared/utils';
import { calculateFinancialImpact } from './financial.calculator';
import { DEFAULT_FINANCIAL_CONFIG, type FinancialConfig } from './financial.config';
import { resolvePricing, resolveProjectedInstanceType } from './financial.pricing';

const logger = createLogger('FinancialEngine');

export interface FinancialEngineOptions {
  provider: ProviderInterface;
  config?: FinancialConfig;
}

/**
 * Financial Engine — estimates financial impact using provider pricing and evidence.
 * Does not generate recommendations or perform verification.
 */
export class FinancialEngine implements FinancialEngineInterface {
  readonly name = 'Financial Engine';
  private readonly provider: ProviderInterface;
  private readonly config: FinancialConfig;

  constructor(options: FinancialEngineOptions) {
    this.provider = options.provider;
    this.config = options.config ?? DEFAULT_FINANCIAL_CONFIG;
  }

  async execute(request: FinancialRequest): Promise<Result<FinancialImpact>> {
    const start = Date.now();
    logger.info('Financial calculation started', {
      workflowId: request.context.workflowId,
      engine: this.name,
      operation: 'execute',
    });

    try {
      if (!request.evidence) {
        throw new AppError('INVALID_EVIDENCE', 'Evidence is required for financial calculation', 400);
      }

      if (request.governance.decision === GOVERNANCE_STATUS.REJECTED) {
        return {
          success: false,
          error: {
            engine: this.name,
            code: 'GOVERNANCE_BLOCKED',
            reason: 'Governance rejected — financial estimation not permitted',
            recovery: 'Resolve governance policy failures before financial estimation',
          },
        };
      }

      const projectedType = resolveProjectedInstanceType(
        request.evidence,
        request.candidate.resourceId
      );
      const hasProjectedTarget = projectedType !== undefined && projectedType.length > 0;

      logger.info('Pricing data retrieved', {
        workflowId: request.context.workflowId,
        engine: this.name,
        operation: 'resolvePricing',
        status: 'started',
      });

      const pricing = await resolvePricing({
        evidence: request.evidence,
        region: request.candidate.region,
        provider: this.provider,
        config: this.config,
      });

      const impact = calculateFinancialImpact(pricing, this.config, hasProjectedTarget);

      logger.info('Savings estimated', {
        workflowId: request.context.workflowId,
        engine: this.name,
        operation: 'calculateSavings',
        status: impact.status,
      });

      logger.info('Financial report generated', {
        workflowId: request.context.workflowId,
        engine: this.name,
        durationMs: Date.now() - start,
        status: impact.status,
      });

      logger.info('Financial calculation completed', {
        workflowId: request.context.workflowId,
        engine: this.name,
        durationMs: Date.now() - start,
        status: impact.status,
      });

      return { success: true, data: impact };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown financial error';
      const code = error instanceof AppError ? error.code : 'CALCULATION_FAILED';

      logger.error('Financial calculation failed', {
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
          recovery: 'Verify pricing data availability from the provider',
        },
      };
    }
  }

  /** Return the active financial configuration. */
  getConfig(): FinancialConfig {
    return { ...this.config };
  }
}

export function createFinancialEngine(options: FinancialEngineOptions): FinancialEngine {
  return new FinancialEngine(options);
}

export { calculateFinancialImpact } from './financial.calculator';
export { resolvePricing, resolveProjectedInstanceType } from './financial.pricing';
export { generateFinancialReport } from './financial.summary';
