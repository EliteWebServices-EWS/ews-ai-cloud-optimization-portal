import type { EvidenceEngineInterface, ProviderInterface } from '../../shared/interfaces';
import type { EvidenceRequest, EvidenceResult, Result } from '../../shared/types';
import { EVIDENCE_STATUS } from '../../shared/constants';
import { createLogger } from '../../shared/utils';

const logger = createLogger('EvidenceEngine');

/**
 * Evidence Engine — collects and normalizes provider data into Evidence objects.
 * Sprint 1: skeleton with placeholder normalization logic.
 */
export class EvidenceEngine implements EvidenceEngineInterface {
  readonly name = 'Evidence Engine';

  constructor(private readonly provider: ProviderInterface) {}

  async execute(request: EvidenceRequest): Promise<Result<EvidenceResult>> {
    const start = Date.now();
    logger.info('Collecting evidence', {
      workflowId: request.context.workflowId,
      engine: this.name,
      operation: 'execute',
    });

    try {
      const metrics = await this.provider.getMetrics(
        request.candidate.resourceId,
        request.candidate.region
      );
      const instanceType = String(request.candidate.metadata?.instanceType ?? 't3.medium');
      const pricing = await this.provider.getPricing(instanceType, request.candidate.region);

      const avgCpu =
        metrics.cpuUtilization.reduce((sum, v) => sum + v, 0) / metrics.cpuUtilization.length;

      const evidence = {
        resourceId: request.candidate.resourceId,
        resourceType: request.candidate.resourceType,
        region: request.candidate.region,
        status: EVIDENCE_STATUS.COMPLETE,
        cpuUtilization: Math.round(avgCpu * 100) / 100,
        memoryUtilization:
          metrics.memoryUtilization.reduce((sum, v) => sum + v, 0) /
          metrics.memoryUtilization.length,
        monthlyCost: pricing.monthlyRate,
        instanceType,
        tags: request.candidate.tags,
        collectedAt: new Date().toISOString(),
      };

      logger.info('Evidence collected', {
        workflowId: request.context.workflowId,
        engine: this.name,
        durationMs: Date.now() - start,
        status: 'completed',
      });

      return {
        success: true,
        data: {
          evidence,
          status: EVIDENCE_STATUS.COMPLETE,
        },
      };
    } catch (error) {
      logger.error('Evidence collection failed', {
        workflowId: request.context.workflowId,
        engine: this.name,
        durationMs: Date.now() - start,
        status: 'failed',
      });

      return {
        success: false,
        error: {
          engine: this.name,
          code: 'EVIDENCE_INCOMPLETE',
          reason: error instanceof Error ? error.message : 'Unknown evidence error',
          recovery: 'Retry after metrics collection.',
        },
      };
    }
  }
}

export function createEvidenceEngine(provider: ProviderInterface): EvidenceEngine {
  return new EvidenceEngine(provider);
}
