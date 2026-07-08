import type { GovernanceEngineInterface } from '../../shared/interfaces';
import type { GovernanceRequest, GovernanceResult, Result } from '../../shared/types';
import { EVIDENCE_STATUS } from '../../shared/constants';
import { AppError, createLogger } from '../../shared/utils';
import { DEFAULT_GOVERNANCE_CONFIG, type GovernanceConfig } from './governance.config';
import { deriveGovernanceDecision, evaluatePolicies } from './governance.policies';
import { calculateReadiness } from './governance.readiness';

const logger = createLogger('GovernanceEngine');

export interface GovernanceEngineOptions {
  config?: GovernanceConfig;
}

/**
 * Governance Engine — evaluates evidence quality, applies governance policies,
 * and calculates readiness before financial calculations or recommendations.
 */
export class GovernanceEngine implements GovernanceEngineInterface {
  readonly name = 'Governance Engine';
  private readonly config: GovernanceConfig;

  constructor(options: GovernanceEngineOptions = {}) {
    this.config = options.config ?? DEFAULT_GOVERNANCE_CONFIG;
  }

  async execute(request: GovernanceRequest): Promise<Result<GovernanceResult>> {
    const start = Date.now();
    logger.info('Governance evaluation started', {
      workflowId: request.context.workflowId,
      engine: this.name,
      operation: 'execute',
    });

    try {
      if (!request.evidence) {
        throw new AppError('GOVERNANCE_DATA_MISSING', 'Evidence is required for governance evaluation', 400);
      }

      if (request.evidenceStatus === EVIDENCE_STATUS.INCOMPLETE) {
        return {
          success: false,
          error: {
            engine: this.name,
            code: 'INVALID_EVIDENCE',
            reason: 'Evidence status is incomplete — cannot evaluate governance',
            recovery: 'Complete evidence collection before governance evaluation',
          },
        };
      }

      const ruleContext = {
        candidate: request.candidate,
        evidence: request.evidence,
        validation: request.validation,
        config: this.config,
      };

      const policies = evaluatePolicies(ruleContext);
      for (const policy of policies) {
        logger.info('Policy evaluated', {
          workflowId: request.context.workflowId,
          engine: this.name,
          operation: 'evaluatePolicy',
          status: policy.status,
        });
      }

      const readiness = calculateReadiness({
        evidence: request.evidence,
        config: this.config,
      });

      logger.info('Readiness calculated', {
        workflowId: request.context.workflowId,
        engine: this.name,
        operation: 'calculateReadiness',
        status: readiness.status,
      });

      const decision = deriveGovernanceDecision(policies, readiness, this.config);

      const result: GovernanceResult = {
        status: readiness.status,
        decision: decision.decision,
        readinessScore: readiness.score,
        readiness,
        reason: decision.reason,
        approver: decision.approver,
        policies,
      };

      logger.info('Governance complete', {
        workflowId: request.context.workflowId,
        engine: this.name,
        durationMs: Date.now() - start,
        status: result.status,
      });

      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown governance error';
      const code = error instanceof AppError ? error.code : 'POLICY_EVALUATION_FAILED';

      logger.error('Governance evaluation failed', {
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
          recovery: 'Verify evidence completeness and governance configuration',
        },
      };
    }
  }

  /** Return the active governance configuration. */
  getConfig(): GovernanceConfig {
    return { ...this.config };
  }
}

export function createGovernanceEngine(options?: GovernanceEngineOptions): GovernanceEngine {
  return new GovernanceEngine(options);
}

/** Calculate readiness independently — reusable by plugins without full governance evaluation. */
export { calculateReadiness } from './governance.readiness';
