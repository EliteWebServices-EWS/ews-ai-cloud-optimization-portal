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
} from './engines';
import { createExecutionSimulator } from './execution';
import { createWorkflowOrchestrator } from './orchestrator';
import { createPluginRegistry } from './plugins';
import { createProvider } from './providers';
import { PROVIDER_NAMES } from './shared/constants';
import { createLogger } from './shared/utils';

const logger = createLogger('Server');
const PORT = Number(process.env.PORT ?? 3000);

/** Bootstrap and start the SISU'M backend API server. */
export function createApp(): express.Application {
  const provider = createProvider(PROVIDER_NAMES.MOCK);
  const pluginRegistry = createPluginRegistry(provider);

  const learningStore = createLearningStore();
  const executionSimulator = createExecutionSimulator();

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

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
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
    activeProvider: PROVIDER_NAMES.MOCK,
    executionSimulator,
    learningStore,
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
