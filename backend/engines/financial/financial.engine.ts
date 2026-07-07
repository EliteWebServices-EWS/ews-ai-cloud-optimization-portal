import type { FinancialEngineInterface } from '../../shared/interfaces';
import type { FinancialImpact, FinancialRequest, Result } from '../../shared/types';
import { createLogger } from '../../shared/utils';

const logger = createLogger('FinancialEngine');

/**
 * Financial Engine — calculates financial impact of recommendations.
 * Sprint 1: skeleton with placeholder calculations.
 */
export class FinancialEngine implements FinancialEngineInterface {
  readonly name = 'Financial Engine';

  async execute(request: FinancialRequest): Promise<Result<FinancialImpact>> {
    const start = Date.now();
    logger.info('Calculating financial impact', {
      workflowId: request.context.workflowId,
      engine: this.name,
      operation: 'execute',
    });

    // TODO: Implement real pricing calculations in Sprint 2+
    const currentCost = request.evidence.monthlyCost ?? 85.2;
    const recommendedCost = Math.round(currentCost * 0.69 * 100) / 100;
    const monthlySavings = Math.round((currentCost - recommendedCost) * 100) / 100;
    const annualSavings = Math.round(monthlySavings * 12 * 100) / 100;
    const roi = currentCost > 0 ? Math.round((monthlySavings / currentCost) * 1000) / 10 : 0;

    const result: FinancialImpact = {
      currentCost,
      recommendedCost,
      monthlySavings,
      annualSavings,
      roi,
      currency: 'USD',
    };

    logger.info('Financial impact calculated', {
      workflowId: request.context.workflowId,
      engine: this.name,
      durationMs: Date.now() - start,
      status: 'completed',
    });

    return { success: true, data: result };
  }
}

export function createFinancialEngine(): FinancialEngine {
  return new FinancialEngine();
}
