import { Router, type Request, type Response } from 'express';
import type { WorkflowOrchestrator } from '../../orchestrator';
import type { PluginRegistry } from '../../plugins';
import { PLUGIN_NAMES, PROVIDER_NAMES } from '../../shared/constants';
import { buildErrorResponse, buildSuccessResponse, generateRequestId } from '../../shared/utils';
import { listProviders } from '../../providers';

export interface ApiDependencies {
  orchestrator: WorkflowOrchestrator;
  pluginRegistry: PluginRegistry;
  activeProvider: string;
}

/** Health check routes. */
export function createHealthRoutes(): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    const requestId = generateRequestId();
    res.json(
      buildSuccessResponse(
        {
          status: 'healthy',
          service: 'sisum-backend',
        },
        requestId
      )
    );
  });

  return router;
}

/** Plugin discovery routes. */
export function createPluginRoutes(deps: Pick<ApiDependencies, 'pluginRegistry'>): Router {
  const router = Router();

  router.get('/plugins', (_req: Request, res: Response) => {
    const requestId = generateRequestId();
    const plugins = deps.pluginRegistry.list();

    res.json(
      buildSuccessResponse(
        {
          plugins: plugins.map((p) => ({
            name: p.name,
            version: p.version,
            description: p.description,
            resourceTypes: p.resourceTypes,
          })),
        },
        requestId
      )
    );
  });

  return router;
}

/** Provider information routes. */
export function createProviderRoutes(deps: Pick<ApiDependencies, 'activeProvider'>): Router {
  const router = Router();

  router.get('/providers', (_req: Request, res: Response) => {
    const requestId = generateRequestId();

    res.json(
      buildSuccessResponse(
        {
          providers: listProviders(),
          active: deps.activeProvider,
        },
        requestId
      )
    );
  });

  return router;
}

/** Workflow demo routes. */
export function createWorkflowRoutes(deps: Pick<ApiDependencies, 'orchestrator'>): Router {
  const router = Router();

  router.get('/workflow/demo', async (_req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const result = await deps.orchestrator.runDemoWorkflow({
        plugin: PLUGIN_NAMES.EC2,
      });

      res.json(buildSuccessResponse(result, requestId));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workflow failed';
      res.status(500).json(
        buildErrorResponse('WORKFLOW_FAILED', message, requestId, 'orchestrator')
      );
    }
  });

  return router;
}

/** Compose all API v1 routes. */
export function createApiRoutes(deps: ApiDependencies): Router {
  const router = Router();

  router.use(createHealthRoutes());
  router.use(createPluginRoutes(deps));
  router.use(createProviderRoutes(deps));
  router.use(createWorkflowRoutes(deps));

  return router;
}

export { PROVIDER_NAMES };
