import { Router, type Request, type Response } from 'express';
import type { WorkflowOrchestrator } from '../../orchestrator';
import type { PluginRegistry } from '../../plugins';
import type { ProviderInterface } from '../../shared/interfaces';
import { DEFAULT_REGION, PLUGIN_NAMES, PROVIDER_NAMES } from '../../shared/constants';
import {
  AppError,
  buildErrorResponse,
  buildSuccessResponse,
  generateRequestId,
  isAppError,
} from '../../shared/utils';
import { listProviders } from '../../providers';

export interface ApiDependencies {
  orchestrator: WorkflowOrchestrator;
  pluginRegistry: PluginRegistry;
  provider: ProviderInterface;
  activeProvider: string;
}

function handleRouteError(
  res: Response,
  error: unknown,
  requestId: string,
  stage: string
): void {
  if (isAppError(error)) {
    res.status(error.statusCode).json(
      buildErrorResponse(error.code, error.message, requestId, stage)
    );
    return;
  }

  const message = error instanceof Error ? error.message : 'Request failed';
  res.status(500).json(buildErrorResponse('ENGINE_ERROR', message, requestId, stage));
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
export function createPluginRoutes(deps: Pick<ApiDependencies, 'pluginRegistry' | 'orchestrator'>): Router {
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

  router.get('/plugins/ec2/evidence', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      const evidencePackage = await deps.orchestrator.runEvidenceWorkflow({
        plugin: PLUGIN_NAMES.EC2,
        resourceId,
      });

      res.json(
        buildSuccessResponse(
          {
            candidate: evidencePackage.candidate,
            evidence: {
              telemetry: evidencePackage.evidence.telemetry,
              metrics: evidencePackage.evidence.metrics,
              pricing: evidencePackage.evidence.pricing,
              recommendations: evidencePackage.evidence.recommendations,
              tags: evidencePackage.evidence.tags,
              instance: evidencePackage.evidence.instance,
            },
            status: evidencePackage.status,
            validation: evidencePackage.validation,
          },
          requestId
        )
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'evidence');
    }
  });

  return router;
}

/** Provider information routes. */
export function createProviderRoutes(deps: Pick<ApiDependencies, 'activeProvider' | 'provider'>): Router {
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

  router.get('/providers/mock/instances', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      if (deps.provider.name !== PROVIDER_NAMES.MOCK) {
        throw new AppError('PROVIDER_UNAVAILABLE', 'Mock provider is not active', 503);
      }

      const region = typeof req.query.region === 'string' ? req.query.region : DEFAULT_REGION;
      const instances = await deps.provider.getInstances(region);
      res.json(buildSuccessResponse({ instances }, requestId));
    } catch (error) {
      handleRouteError(res, error, requestId, 'provider');
    }
  });

  router.get('/providers/mock/metrics', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      if (deps.provider.name !== PROVIDER_NAMES.MOCK) {
        throw new AppError('PROVIDER_UNAVAILABLE', 'Mock provider is not active', 503);
      }

      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      if (!resourceId) {
        throw new AppError('INVALID_REQUEST', 'resourceId query parameter is required', 400);
      }

      const region = typeof req.query.region === 'string' ? req.query.region : DEFAULT_REGION;
      const metrics = await deps.provider.getMetrics(resourceId, region);
      res.json(buildSuccessResponse({ metrics }, requestId));
    } catch (error) {
      handleRouteError(res, error, requestId, 'provider');
    }
  });

  return router;
}

/** Workflow routes. */
export function createWorkflowRoutes(deps: Pick<ApiDependencies, 'orchestrator'>): Router {
  const router = Router();

  router.get('/workflow/evidence', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      const evidencePackage = await deps.orchestrator.runEvidenceWorkflow({
        plugin: PLUGIN_NAMES.EC2,
        resourceId,
      });

      res.json(
        buildSuccessResponse(
          {
            candidate: evidencePackage.candidate,
            evidence: {
              telemetry: evidencePackage.evidence.telemetry,
              metrics: evidencePackage.evidence.metrics,
              pricing: evidencePackage.evidence.pricing,
              recommendations: evidencePackage.evidence.recommendations,
              tags: evidencePackage.evidence.tags,
              instance: evidencePackage.evidence.instance,
            },
            status: evidencePackage.status,
            validation: evidencePackage.validation,
          },
          requestId
        )
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'evidence');
    }
  });

  router.get('/workflow/demo', async (_req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const result = await deps.orchestrator.runDemoWorkflow({
        plugin: PLUGIN_NAMES.EC2,
      });

      res.json(buildSuccessResponse(result, requestId));
    } catch (error) {
      handleRouteError(res, error, requestId, 'orchestrator');
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
