import type { GovernanceEngineInterface } from '../../shared/interfaces';
import type { GovernanceRequest, GovernanceResult, Result } from '../../shared/types';
import { GOVERNANCE_STATUS } from '../../shared/constants';
import { createLogger } from '../../shared/utils';

const logger = createLogger('GovernanceEngine');

/**
 * Governance Engine — evaluates policies and produces governance decisions.
 * Sprint 1: skeleton with placeholder policy evaluation.
 */
export class GovernanceEngine implements GovernanceEngineInterface {
  readonly name = 'Governance Engine';

  async execute(request: GovernanceRequest): Promise<Result<GovernanceResult>> {
    const start = Date.now();
    logger.info('Evaluating governance', {
      workflowId: request.context.workflowId,
      engine: this.name,
      operation: 'execute',
    });

    // TODO: Implement real policy evaluation in Sprint 2+
    const environment = request.evidence.tags?.Environment ?? 'unknown';
    const isProduction = environment.toLowerCase() === 'production';

    const result: GovernanceResult = isProduction
      ? {
          status: GOVERNANCE_STATUS.NEEDS_APPROVAL,
          reason: 'Production workload requires approval',
          approver: 'Cloud Operations Team',
          policiesEvaluated: ['environment-policy'],
        }
      : {
          status: GOVERNANCE_STATUS.APPROVED,
          reason: 'Non-production workload auto-approved',
          policiesEvaluated: ['environment-policy'],
        };

    logger.info('Governance evaluated', {
      workflowId: request.context.workflowId,
      engine: this.name,
      durationMs: Date.now() - start,
      status: result.status,
    });

    return { success: true, data: result };
  }
}

export function createGovernanceEngine(): GovernanceEngine {
  return new GovernanceEngine();
}
