import express from 'express';
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
import { PROVIDER_NAMES, type ProviderName } from './shared/constants';
import { createLogger } from './shared/utils';

const logger = createLogger('Server');
const PORT = Number(process.env.PORT ?? 3000);

/** Resolve active provider from PROVIDER_MODE; unknown values safely fall back to mock. */
export function resolveProviderName(): ProviderName {
  const mode = (process.env.PROVIDER_MODE ?? PROVIDER_NAMES.MOCK).toLowerCase();
  if (mode === PROVIDER_NAMES.AWS) {
    return PROVIDER_NAMES.AWS;
  }
  return PROVIDER_NAMES.MOCK;
}

/** Resolve CORS allow-origin header; defaults to * for local development. */
export function resolveCorsOrigin(): string {
  const origin = process.env.CORS_ORIGIN?.trim();
  return origin && origin.length > 0 ? origin : '*';
}

/** Bootstrap and start the SISU'M backend API server. */
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
    getPlugin: (name: import('./shared/constants').PluginName) => pluginRegistry.get(name),
  });

  const app = express();

  const corsOrigin = resolveCorsOrigin();

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', corsOrigin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());

  app.use('/api/v1', createApiRoutes({
    orchestrator,
    pluginRegistry,
    provider,
    activeProvider,
    executionSimulator,
    learningStore,
    reportingEngine,
  }));

  return app;
}

export function startServer(): void {
  const app = createApp();

  app.listen(PORT, () => {
    logger.info(`SISU'M backend listening on port ${PORT}`, {
      operation: 'startServer',
      status: 'running',
    });
  });
}

if (require.main === module) {
  startServer();
}
