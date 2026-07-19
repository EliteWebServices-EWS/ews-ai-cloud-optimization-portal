import express from 'express';
import {
  AUDIT_EVENTS,
  getAuditActor,
  getCorrelationId,
  getRequestId,
  writeAuditEvent,
} from './audit';
import { createApiRoutes } from './api/routes';
import {
  createEvidenceEngine,
  createFinancialEngine,
  createGovernanceEngine,
  createConfidenceEngine,
  createRecommendationEngine,
  createVerificationEngine,
  createLearningStore,
  createReportingEngine,
} from './engines';
import { createExecutionSimulator } from './execution';
import { createWorkflowOrchestrator } from './orchestrator';
import { createPluginRegistry } from './plugins';
import { createProvider } from './providers';
import {
  PROVIDER_NAMES,
  type ProviderName,
} from './shared/constants';
import { createLogger } from './shared/utils';

const logger = createLogger('Server');
const PORT = Number(process.env.PORT ?? 3000);

/**
 * Resolve active provider from PROVIDER_MODE.
 * Unknown values safely fall back to the mock provider.
 */
export function resolveProviderName(): ProviderName {
  const mode = (
    process.env.PROVIDER_MODE ?? PROVIDER_NAMES.MOCK
  ).toLowerCase();

  if (mode === PROVIDER_NAMES.AWS) {
    return PROVIDER_NAMES.AWS;
  }

  return PROVIDER_NAMES.MOCK;
}

/**
 * Resolve the CORS allow-origin header.
 * Defaults to * for local development.
 */
export function resolveCorsOrigin(): string {
  const origin = process.env.CORS_ORIGIN?.trim();

  return origin && origin.length > 0 ? origin : '*';
}

/**
 * Bootstrap and configure the SISU'M backend API server.
 */
export function createApp(): express.Application {
  const activeProvider = resolveProviderName();
  const provider = createProvider(activeProvider);
  const pluginRegistry = createPluginRegistry(provider);

  const learningStore = createLearningStore();
  const executionSimulator = createExecutionSimulator();
  const reportingEngine = createReportingEngine();

  const orchestrator = createWorkflowOrchestrator({
    evidenceEngine: createEvidenceEngine(),
    governanceEngine: createGovernanceEngine(),
    financialEngine: createFinancialEngine({ provider }),
    confidenceEngine: createConfidenceEngine(),
    recommendationEngine: createRecommendationEngine(),
    verificationEngine: createVerificationEngine(),
    executionSimulator,
    learningStore,
    getPlugin: (
      name: import('./shared/constants').PluginName
    ) => pluginRegistry.get(name),
  });

  const app = express();
  const corsOrigin = resolveCorsOrigin();

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', corsOrigin);

    res.header(
      'Access-Control-Allow-Methods',
      'GET, POST, OPTIONS'
    );

    res.header(
      'Access-Control-Allow-Headers',
      [
        'Content-Type',
        'Authorization',
        'X-Request-Id',
        'X-Correlation-Id',
      ].join(', ')
    );

    res.header(
      'Access-Control-Expose-Headers',
      'X-Request-Id, X-Correlation-Id'
    );

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    next();
  });

  app.use(express.json());

  app.use((req, res, next) => {
    const startedAt = Date.now();

    const requestId = getRequestId(req);
    const correlationId = getCorrelationId(
      req,
      requestId
    );

    req.headers['x-request-id'] = requestId;
    req.headers['x-correlation-id'] = correlationId;

    const actor = getAuditActor(req);

    res.setHeader('x-request-id', requestId);
    res.setHeader(
      'x-correlation-id',
      correlationId
    );

    writeAuditEvent({
      eventName: AUDIT_EVENTS.REQUEST_STARTED,
      outcome: 'started',
      requestId,
      correlationId,
      actor,
      action: 'http.request',
      method: req.method,
      path: req.path,
    });

    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const successful = res.statusCode < 400;

      writeAuditEvent({
        eventName: successful
          ? AUDIT_EVENTS.REQUEST_COMPLETED
          : AUDIT_EVENTS.REQUEST_FAILED,
        outcome: successful
          ? 'success'
          : 'failure',
        requestId,
        correlationId,
        actor,
        action: 'http.request',
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
      });
    });

    next();
  });

  app.use(
    '/api/v1',
    createApiRoutes({
      orchestrator,
      pluginRegistry,
      provider,
      activeProvider,
      executionSimulator,
      learningStore,
      reportingEngine,
    })
  );

  return app;
}

/**
 * Start the local Express server.
 */
export function startServer(): void {
  const app = createApp();

  app.listen(PORT, () => {
    logger.info(
      `SISU'M backend listening on port ${PORT}`,
      {
        operation: 'startServer',
        status: 'running',
      }
    );
  });
}

if (require.main === module) {
  startServer();
}
