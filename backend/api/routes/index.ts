import { Router, type Request, type Response } from 'express';
import type { WorkflowOrchestrator } from '../../orchestrator';
import type { PluginRegistry } from '../../plugins';
import type { ProviderInterface } from '../../shared/interfaces';
import { DEFAULT_REGION, PLUGIN_NAMES, PROVIDER_NAMES } from '../../shared/constants';
import { GOVERNANCE_POLICY_CATALOG, DEFAULT_GOVERNANCE_CONFIG } from '../../engines/governance';
import { DEFAULT_FINANCIAL_CONFIG, generateFinancialReport } from '../../engines/financial';
import { DEFAULT_CONFIDENCE_CONFIG } from '../../engines/confidence';
import { DEFAULT_RECOMMENDATION_CONFIG } from '../../engines/recommendation';
import { MOCK_PRICING } from '../../providers/mock/data';
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

function formatGovernanceResponse(
  result: Awaited<ReturnType<WorkflowOrchestrator['runGovernanceWorkflow']>>
) {
  return {
    candidate: result.candidate,
    evidence: {
      telemetry: result.evidence.telemetry,
      metrics: result.evidence.metrics,
      pricing: result.evidence.pricing,
      recommendations: result.evidence.recommendations,
      tags: result.evidence.tags,
      instance: result.evidence.instance,
    },
    governance: {
      status: result.governance.status,
      decision: result.governance.decision,
      readinessScore: result.governance.readinessScore,
      reason: result.governance.reason,
      approver: result.governance.approver,
      policies: result.governance.policies,
    },
    readiness: result.readiness,
  };
}

function formatFinancialResponse(
  result: Awaited<ReturnType<WorkflowOrchestrator['runFinancialWorkflow']>>
) {
  return {
    candidate: result.candidate,
    evidence: {
      telemetry: result.evidence.telemetry,
      metrics: result.evidence.metrics,
      pricing: result.evidence.pricing,
      recommendations: result.evidence.recommendations,
      tags: result.evidence.tags,
      instance: result.evidence.instance,
    },
    governance: {
      status: result.governance.status,
      decision: result.governance.decision,
      readinessScore: result.governance.readinessScore,
      reason: result.governance.reason,
      approver: result.governance.approver,
      policies: result.governance.policies,
    },
    financialImpact: {
      currentMonthlyCost: result.financialImpact.currentMonthlyCost,
      projectedMonthlyCost: result.financialImpact.projectedMonthlyCost,
      monthlySavings: result.financialImpact.monthlySavings,
      annualSavings: result.financialImpact.annualSavings,
      percentageReduction: result.financialImpact.percentageReduction,
      status: result.financialImpact.status,
      currency: result.financialImpact.currency,
    },
  };
}

function formatRecommendationResponse(
  result: Awaited<ReturnType<WorkflowOrchestrator['runRecommendationWorkflow']>>
) {
  return {
    candidate: result.candidate,
    evidence: {
      telemetry: result.evidence.telemetry,
      metrics: result.evidence.metrics,
      pricing: result.evidence.pricing,
      recommendations: result.evidence.recommendations,
      tags: result.evidence.tags,
      instance: result.evidence.instance,
    },
    governance: {
      status: result.governance.status,
      decision: result.governance.decision,
      readinessScore: result.governance.readinessScore,
      reason: result.governance.reason,
      approver: result.governance.approver,
      policies: result.governance.policies,
    },
    financialImpact: {
      currentMonthlyCost: result.financialImpact.currentMonthlyCost,
      projectedMonthlyCost: result.financialImpact.projectedMonthlyCost,
      monthlySavings: result.financialImpact.monthlySavings,
      annualSavings: result.financialImpact.annualSavings,
      percentageReduction: result.financialImpact.percentageReduction,
      status: result.financialImpact.status,
      currency: result.financialImpact.currency,
    },
    confidence: {
      score: result.confidence.score,
      status: result.confidence.status,
      reason: result.confidence.reason,
    },
    recommendation: {
      status: result.recommendation.status,
      summary: result.recommendation.summary,
      reason: result.recommendation.reason,
    },
  };
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

  router.get('/plugins/ec2/governance', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      const result = await deps.orchestrator.runGovernanceWorkflow({
        plugin: PLUGIN_NAMES.EC2,
        resourceId,
      });

      res.json(
        buildSuccessResponse(formatGovernanceResponse(result), requestId)
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'governance');
    }
  });

  router.get('/plugins/ec2/financial', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      const result = await deps.orchestrator.runFinancialWorkflow({
        plugin: PLUGIN_NAMES.EC2,
        resourceId,
      });

      res.json(
        buildSuccessResponse(formatFinancialResponse(result), requestId)
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'financial');
    }
  });

  router.get('/plugins/ec2/recommendation', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      const result = await deps.orchestrator.runRecommendationWorkflow({
        plugin: PLUGIN_NAMES.EC2,
        resourceId,
      });

      res.json(
        buildSuccessResponse(formatRecommendationResponse(result), requestId)
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'recommendation');
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

  router.get('/workflow/governance', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      const result = await deps.orchestrator.runGovernanceWorkflow({
        plugin: PLUGIN_NAMES.EC2,
        resourceId,
      });

      res.json(
        buildSuccessResponse(formatGovernanceResponse(result), requestId)
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'governance');
    }
  });

  router.get('/workflow/financial', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      const result = await deps.orchestrator.runFinancialWorkflow({
        plugin: PLUGIN_NAMES.EC2,
        resourceId,
      });

      res.json(
        buildSuccessResponse(formatFinancialResponse(result), requestId)
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'financial');
    }
  });

  router.get('/workflow/recommendation', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      const result = await deps.orchestrator.runRecommendationWorkflow({
        plugin: PLUGIN_NAMES.EC2,
        resourceId,
      });

      res.json(
        buildSuccessResponse(formatRecommendationResponse(result), requestId)
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'recommendation');
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

/** Financial information routes. */
export function createFinancialRoutes(
  deps: Pick<ApiDependencies, 'provider' | 'orchestrator'>
): Router {
  const router = Router();

  router.get('/financial/pricing', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const instanceType = typeof req.query.instanceType === 'string' ? req.query.instanceType : undefined;
      const region = typeof req.query.region === 'string' ? req.query.region : DEFAULT_REGION;

      if (instanceType) {
        const pricing = await deps.provider.getPricing(instanceType, region);
        res.json(buildSuccessResponse({ pricing }, requestId));
        return;
      }

      res.json(
        buildSuccessResponse(
          {
            pricing: Object.values(MOCK_PRICING),
            region,
            source: deps.provider.name,
          },
          requestId
        )
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'financial');
    }
  });

  router.get('/financial/summary', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      const result = await deps.orchestrator.runFinancialWorkflow({
        plugin: PLUGIN_NAMES.EC2,
        resourceId,
      });

      const report = generateFinancialReport(result.financialImpact, DEFAULT_FINANCIAL_CONFIG);

      res.json(
        buildSuccessResponse(
          {
            report,
            configuration: DEFAULT_FINANCIAL_CONFIG,
            methodology: {
              description: 'Savings estimated from provider pricing for current and projected instance types',
              formula: 'monthlySavings = currentMonthlyCost - projectedMonthlyCost',
              annualFormula: 'annualSavings = monthlySavings × monthsPerYear',
              percentageFormula: 'percentageReduction = (monthlySavings / currentMonthlyCost) × 100',
            },
          },
          requestId
        )
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'financial');
    }
  });

  return router;
}

/** Recommendation and confidence catalog routes. */
export function createRecommendationRoutes(
  deps: Pick<ApiDependencies, 'orchestrator'>
): Router {
  const router = Router();

  router.get('/recommendations', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      const result = await deps.orchestrator.runRecommendationWorkflow({
        plugin: PLUGIN_NAMES.EC2,
        resourceId,
      });

      res.json(
        buildSuccessResponse(
          {
            recommendation: result.recommendation,
            configuration: DEFAULT_RECOMMENDATION_CONFIG,
          },
          requestId
        )
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'recommendation');
    }
  });

  router.get('/confidence', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      const result = await deps.orchestrator.runRecommendationWorkflow({
        plugin: PLUGIN_NAMES.EC2,
        resourceId,
      });

      res.json(
        buildSuccessResponse(
          {
            confidence: result.confidence,
            configuration: DEFAULT_CONFIDENCE_CONFIG,
          },
          requestId
        )
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'confidence');
    }
  });

  return router;
}

/** Governance policy catalog routes. */
export function createGovernanceRoutes(): Router {
  const router = Router();

  router.get('/governance/policies', (_req: Request, res: Response) => {
    const requestId = generateRequestId();

    res.json(
      buildSuccessResponse(
        {
          policies: GOVERNANCE_POLICY_CATALOG,
          configuration: DEFAULT_GOVERNANCE_CONFIG,
        },
        requestId
      )
    );
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
  router.use(createGovernanceRoutes());
  router.use(createFinancialRoutes(deps));
  router.use(createRecommendationRoutes(deps));

  return router;
}

export { PROVIDER_NAMES };
