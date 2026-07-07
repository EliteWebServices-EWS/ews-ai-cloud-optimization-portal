import type { EvidenceEngineInterface } from '../../shared/interfaces';
import type { EvidenceRequest, EvidenceResult, Result } from '../../shared/types';
import { EVIDENCE_STATUS } from '../../shared/constants';
import { AppError, createLogger } from '../../shared/utils';
import { normalizeProviderBundle } from './evidence.normalizer';
import { validateProviderBundle } from './evidence.validator';

const logger = createLogger('EvidenceEngine');

/**
 * Evidence Engine — collects, normalizes, and validates provider data into standardized evidence.
 * Provider-agnostic: receives assembled provider data from plugins via the orchestrator.
 */
export class EvidenceEngine implements EvidenceEngineInterface {
  readonly name = 'Evidence Engine';

  async execute(request: EvidenceRequest): Promise<Result<EvidenceResult>> {
    const start = Date.now();
    logger.info('Evidence collection started', {
      workflowId: request.context.workflowId,
      engine: this.name,
      operation: 'execute',
    });

    try {
      if (!request.providerData) {
        throw new AppError(
          'MALFORMED_PROVIDER_RESPONSE',
          'Provider evidence bundle is required',
          400
        );
      }

      logger.info('Provider data received', {
        workflowId: request.context.workflowId,
        engine: this.name,
        operation: 'providerDataReceived',
      });

      const validation = validateProviderBundle(request.providerData);
      logger.info('Evidence validation complete', {
        workflowId: request.context.workflowId,
        engine: this.name,
        operation: 'validate',
        status: validation.valid ? 'valid' : 'invalid',
      });

      if (!validation.valid) {
        return {
          success: false,
          error: {
            engine: this.name,
            code: 'EVIDENCE_INCOMPLETE',
            reason: validation.errors.join('; '),
            recovery: 'Ensure provider returns complete instance, metrics, and pricing data.',
          },
        };
      }

      const normalized = normalizeProviderBundle(request.providerData);
      logger.info('Evidence normalized', {
        workflowId: request.context.workflowId,
        engine: this.name,
        operation: 'normalize',
      });

      const evidencePackage = {
        workflowId: request.context.workflowId,
        candidate: request.candidate,
        evidence: {
          ...normalized,
          collectedAt: new Date().toISOString(),
        },
        status: EVIDENCE_STATUS.COMPLETE,
        validation,
      };

      logger.info('Evidence collection completed', {
        workflowId: request.context.workflowId,
        engine: this.name,
        durationMs: Date.now() - start,
        status: EVIDENCE_STATUS.COMPLETE,
      });

      return {
        success: true,
        data: {
          package: evidencePackage,
          status: EVIDENCE_STATUS.COMPLETE,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown evidence error';
      const code = error instanceof AppError ? error.code : 'PROVIDER_UNAVAILABLE';

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
          code,
          reason: message,
          recovery: 'Retry evidence collection after verifying provider availability.',
        },
      };
    }
  }
}

export function createEvidenceEngine(): EvidenceEngine {
  return new EvidenceEngine();
}
