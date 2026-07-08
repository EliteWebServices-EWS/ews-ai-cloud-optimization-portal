import express from 'express';
import { createApiRoutes } from './api/routes';
import {
  createEvidenceEngine,
  createFinancialEngine,
  createGovernanceEngine,
  createVerificationEngine,
} from './engines';
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

  const orchestrator = createWorkflowOrchestrator({
    evidenceEngine: createEvidenceEngine(),
    governanceEngine: createGovernanceEngine(),
    financialEngine: createFinancialEngine({ provider }),
    verificationEngine: createVerificationEngine(),
    getPlugin: (name: import('./shared/constants').PluginName) => pluginRegistry.get(name),
  });

  const app = express();
  app.use(express.json());

  app.use('/api/v1', createApiRoutes({
    orchestrator,
    pluginRegistry,
    provider,
    activeProvider: PROVIDER_NAMES.MOCK,
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
