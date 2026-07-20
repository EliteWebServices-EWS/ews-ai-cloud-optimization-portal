import { Router, type Request, type Response } from 'express';
import {
  AUDIT_EVENTS,
  AuditPersistenceUnavailableError,
  AuditQueryValidationError,
  getAuditActor,
  getCorrelationId,
  getRequestId,
  isAuditPersistenceEnabled,
  parseAuditQueryFilters,
  queryAuditEvents,
  resolveTenantId,
  scheduleAuditPersistence,
  writeAuditEvent,
  type WriteAuditEventInput,
} from '../../audit';
import type { WorkflowOrchestrator } from '../../orchestrator';
import type { PluginRegistry } from '../../plugins';
import type { ProviderInterface } from '../../shared/interfaces';
import type { ExecutionSimulatorInterface } from '../../execution';
import type { LearningStoreInterface } from '../../engines/learning';
import { DEFAULT_REGION, PLUGIN_NAMES, PROVIDER_NAMES } from '../../shared/constants';
import { GOVERNANCE_POLICY_CATALOG, DEFAULT_GOVERNANCE_CONFIG } from '../../engines/governance';
import { DEFAULT_FINANCIAL_CONFIG, generateFinancialReport } from '../../engines/financial';
import { DEFAULT_CONFIDENCE_CONFIG } from '../../engines/confidence';
import { DEFAULT_RECOMMENDATION_CONFIG } from '../../engines/recommendation';
import { DEFAULT_VERIFICATION_CONFIG } from '../../engines/verification';
import {
  filterReports,
  parseReportFilters,
  toReportGenerationInput,
  type ReportingEngine,
} from '../../engines/reporting';
import { MOCK_PRICING } from '../../providers/mock/data';
import {
  AppError,
  buildErrorResponse,
  buildSuccessResponse,
  generateRequestId,
  isAppError,
} from '../../shared/utils';
import { listProviders } from '../../providers';
import {
  ALL_AUTHENTICATED_ROLES,
  ANALYSIS_ROLES,
  ADMIN_ROLES,
  requireAnyRole,
} from '../../auth';
import {
  validateReportGenerateBody,
  validateWorkflowRunBody,
} from '../../security';

export interface ApiDependencies {
  orchestrator: WorkflowOrchestrator;
  pluginRegistry: PluginRegistry;
  provider: ProviderInterface;
  activeProvider: string;
  executionSimulator: ExecutionSimulatorInterface;
  learningStore: LearningStoreInterface;
  reportingEngine: ReportingEngine;
}

function recordAuditEvent(
  req: Request,
  input: WriteAuditEventInput
): void {
  const event = writeAuditEvent(input);

  scheduleAuditPersistence(req, event);
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

function formatVerificationResponse(
  result: Awaited<ReturnType<WorkflowOrchestrator['runVerificationWorkflow']>>
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
    execution: {
      executionId: result.execution.executionId,
      status: result.execution.status,
      change: result.execution.change,
      message: result.execution.message,
      executedAt: result.execution.executedAt,
    },
    observation: result.observation,
    verification: {
      status: result.verification.status,
      expectedSavings: result.verification.expectedSavings,
      verifiedSavings: result.verification.verifiedSavings,
      actualSavings: result.verification.actualSavings,
      variance: result.verification.variance,
      variancePercentage: result.verification.variancePercentage,
      stateMatched: result.verification.stateMatched,
      confidenceScore: result.verification.confidenceScore,
      message: result.verification.message,
    },
    report: result.report,
  };
}

function formatCompleteResponse(
  result: Awaited<ReturnType<WorkflowOrchestrator['runCompleteWorkflow']>>
) {
  return {
    ...formatVerificationResponse(result),
    workflow: {
      status: result.status,
      currentStage: result.currentStage,
      workflowId: result.workflowId,
      completedAt: result.completedAt,
    },
    learningRecord: result.learningRecord
      ? {
          id: result.learningRecord.id,
          workflowId: result.learningRecord.workflowId,
          recordedAt: result.learningRecord.recordedAt,
        }
      : undefined,
  };
}

function formatWorkflowDetailResponse(
  record: NonNullable<ReturnType<WorkflowOrchestrator['getWorkflow']>>
) {
  const ctx = record.context;
  return {
    metadata: record.metadata,
    status: record.metadata.status,
    executionState: record.metadata.executionState,
    currentStage: ctx.currentStage,
    completedStages: ctx.completedStages,
    failedStages: ctx.failedStages,
    failure: ctx.failure,
    retry: ctx.retry,
    result: record.result,
    candidate: ctx.candidate,
    evidence: ctx.evidence
      ? {
          status: ctx.evidenceStatus,
          validation: ctx.validation,
          telemetry: ctx.evidence.telemetry,
          instance: ctx.evidence.instance,
          pricing: ctx.evidence.pricing,
          recommendations: ctx.evidence.recommendations,
          tags: ctx.evidence.tags,
          collectedAt: ctx.evidence.collectedAt,
        }
      : undefined,
    governance: ctx.governance
      ? {
          status: ctx.governance.status,
          decision: ctx.governance.decision,
          readinessScore: ctx.governance.readinessScore,
          readiness: ctx.readiness,
          reason: ctx.governance.reason,
          approver: ctx.governance.approver,
          policies: ctx.governance.policies,
        }
      : undefined,
    financialImpact: ctx.financialImpact,
    confidence: ctx.confidence,
    recommendation: ctx.recommendation,
    execution: ctx.execution,
    observation: ctx.observation,
    verification: ctx.verification,
    report: ctx.report,
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

/** Workflow routes — Sprint 7 hardened workflow APIs. */
export function createWorkflowRoutes(
  deps: Pick<ApiDependencies, 'orchestrator'>
): Router {
  const router = Router();

  router.post(
    '/workflows/run',
    requireAnyRole(...ANALYSIS_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(
        req,
        requestId
      );
      const actor = getAuditActor(req);
      const startedAt = Date.now();

      let workflowId: string | undefined;

      try {
        const validated = validateWorkflowRunBody(
          req.body,
          DEFAULT_REGION
        );

        const plugin = validated.plugin;
        const mode = validated.mode;
        const resourceId = validated.resourceId;
        const region = validated.region;

        recordAuditEvent(req, {
          eventName: AUDIT_EVENTS.WORKFLOW_STARTED,
          outcome: 'started',
          requestId,
          correlationId,
          actor,
          action: 'workflow.run',
          method: req.method,
          path: req.path,
          resource: {
            type: plugin,
            id: resourceId,
            region,
          },
        });

        const result =
          await deps.orchestrator.executeWorkflow({
            plugin: PLUGIN_NAMES.EC2,
            resourceId,
            region,
            mode,
            triggerSource: 'api',
          });

        workflowId = result.workflowId;

        const statusCode =
          result.status === 'failed' ? 422 : 201;

        const durationMs =
          Date.now() - startedAt;

        if (result.status === 'failed') {
          recordAuditEvent(req, {
            eventName:
              AUDIT_EVENTS.WORKFLOW_FAILED,
            outcome: 'failure',
            requestId,
            correlationId,
            actor,
            action: 'workflow.run',
            method: req.method,
            path: req.path,
            statusCode,
            durationMs,
            workflowId,
            resource: {
              type: PLUGIN_NAMES.EC2,
              id:
                result.candidate?.resourceId ??
                resourceId,
              region:
                result.candidate?.region ??
                region,
            },
            reason:
              'Workflow completed with a failed status.',
            errorCode: 'WORKFLOW_FAILED',
          });
        } else {
          recordAuditEvent(req, {
            eventName:
              AUDIT_EVENTS.WORKFLOW_COMPLETED,
            outcome: 'success',
            requestId,
            correlationId,
            actor,
            action: 'workflow.run',
            method: req.method,
            path: req.path,
            statusCode,
            durationMs,
            workflowId,
            resource: {
              type: PLUGIN_NAMES.EC2,
              id:
                result.candidate?.resourceId ??
                resourceId,
              region:
                result.candidate?.region ??
                region,
            },
          });
        }

        res.status(statusCode).json(
          buildSuccessResponse(
            {
              workflowId: result.workflowId,
              status: result.status,
              executionState:
                result.executionState,
              durationMs: result.durationMs,
              completedStages:
                result.completedStages,
              failedStages: result.failedStages,
              failure: result.failure,

              candidate: result.candidate
                ? {
                    resourceId:
                      result.candidate.resourceId,
                    resourceType:
                      result.candidate.resourceType,
                    region:
                      result.candidate.region,
                  }
                : undefined,

              recommendation:
                result.recommendation
                  ? {
                      status:
                        result.recommendation
                          .status,
                      summary:
                        result.recommendation
                          .summary,
                      reason:
                        result.recommendation
                          .reason,
                    }
                  : undefined,

              financialImpact:
                result.financialImpact
                  ? {
                      monthlySavings:
                        result.financialImpact
                          .monthlySavings,
                      annualSavings:
                        result.financialImpact
                          .annualSavings,
                      status:
                        result.financialImpact
                          .status,
                    }
                  : undefined,

              verification:
                result.verification
                  ? {
                      status:
                        result.verification
                          .status,
                    }
                  : undefined,
            },
            requestId
          )
        );
      } catch (error) {
        const durationMs =
          Date.now() - startedAt;

        const statusCode = isAppError(error)
          ? error.statusCode
          : 500;

        const errorCode = isAppError(error)
          ? error.code
          : 'ENGINE_ERROR';

        const reason =
          error instanceof Error
            ? error.message
            : 'Workflow execution failed.';

        recordAuditEvent(req, {
          eventName:
            AUDIT_EVENTS.WORKFLOW_FAILED,
          outcome: 'failure',
          requestId,
          correlationId,
          actor,
          action: 'workflow.run',
          method: req.method,
          path: req.path,
          statusCode,
          durationMs,
          workflowId,
          resource: {
            type: plugin,
            id: resourceId,
            region,
          },
          reason,
          errorCode,
        });

        handleRouteError(
          res,
          error,
          requestId,
          'workflow'
        );
      }
    }
  );

  router.get('/workflows/status/:id', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const workflowId = req.params.id;
      const status = deps.orchestrator.getWorkflowStatus(workflowId);

      if (!status) {
        throw new AppError('NOT_FOUND', `Workflow not found: ${workflowId}`, 404);
      }

      res.json(
        buildSuccessResponse(
          {
            workflowId: status.metadata.workflowId,
            status: status.metadata.status,
            executionState: status.metadata.executionState,
            plugin: status.metadata.plugin,
            createdAt: status.metadata.createdAt,
            completedAt: status.metadata.completedAt,
            triggerSource: status.metadata.triggerSource,
            currentStage: status.currentStage,
            completedStages: status.completedStages,
            failedStages: status.failedStages,
            failure: status.failure,
          },
          requestId
        )
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'workflow');
    }
  });

  router.get('/workflows/:id', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const workflowId = req.params.id;
      const record = deps.orchestrator.getWorkflow(workflowId);

      if (!record) {
        throw new AppError('NOT_FOUND', `Workflow not found: ${workflowId}`, 404);
      }

      res.json(
        buildSuccessResponse(formatWorkflowDetailResponse(record), requestId)
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'workflow');
    }
  });

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

  router.get('/workflow/verification', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      const result = await deps.orchestrator.runVerificationWorkflow({
        plugin: PLUGIN_NAMES.EC2,
        resourceId,
      });

      res.json(
        buildSuccessResponse(formatVerificationResponse(result), requestId)
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'verification');
    }
  });

  router.get('/workflow/complete', async (req: Request, res: Response) => {
    const requestId = generateRequestId();

    try {
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      const result = await deps.orchestrator.runCompleteWorkflow({
        plugin: PLUGIN_NAMES.EC2,
        resourceId,
      });

      res.json(
        buildSuccessResponse(formatCompleteResponse(result), requestId)
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'complete');
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

/** Execution simulation and verification report routes. */
export function createVerificationRoutes(
  deps: Pick<
    ApiDependencies,
    'orchestrator' | 'executionSimulator' | 'learningStore'
  >
): Router {
  const router = Router();

  router.post(
    '/execution/simulate',
    requireAnyRole(...ANALYSIS_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(
        req,
        requestId
      );
      const actor = getAuditActor(req);
      const startedAt = Date.now();

      let workflowId: string | undefined;
      let executionId: string | undefined;
      let executionRegion = DEFAULT_REGION;

      const resourceId =
        typeof req.body?.resourceId === 'string'
          ? req.body.resourceId
          : typeof req.query.resourceId === 'string'
            ? req.query.resourceId
            : undefined;

      try {
        const recommendationWorkflow =
          await deps.orchestrator.runRecommendationWorkflow({
            plugin: PLUGIN_NAMES.EC2,
            resourceId,
          });

        workflowId =
          recommendationWorkflow.workflowId;

        executionRegion =
          recommendationWorkflow.candidate.region;

        const executionResult =
          await deps.executionSimulator.simulate({
            context: {
              workflowId:
                recommendationWorkflow.workflowId,
              plugin: PLUGIN_NAMES.EC2,
              provider: PROVIDER_NAMES.MOCK,
              region:
                recommendationWorkflow.candidate
                  .region,
              mode: 'demo',
              startedAt:
                new Date().toISOString(),
              candidate:
                recommendationWorkflow.candidate,
            },
            candidate:
              recommendationWorkflow.candidate,
            recommendation:
              recommendationWorkflow.recommendation,
          });

        executionId =
          executionResult.executionId;

        const durationMs =
          Date.now() - startedAt;

        recordAuditEvent(req, {
          eventName:
            AUDIT_EVENTS.EXECUTION_SIMULATED,
          outcome: 'success',
          requestId,
          correlationId,
          actor,
          action: 'execution.simulate',
          method: req.method,
          path: req.path,
          statusCode: 200,
          durationMs,
          workflowId,
          executionId,
          resource: {
            type: PLUGIN_NAMES.EC2,
            id:
              recommendationWorkflow.candidate
                .resourceId,
            region:
              recommendationWorkflow.candidate
                .region,
          },
        });

        res.json(
          buildSuccessResponse(
            {
              execution: executionResult,
              recommendation:
                recommendationWorkflow.recommendation,
            },
            requestId
          )
        );
      } catch (error) {
        const durationMs =
          Date.now() - startedAt;

        const statusCode =
          isAppError(error)
            ? error.statusCode
            : 500;

        const errorCode =
          isAppError(error)
            ? error.code
            : 'ENGINE_ERROR';

        const reason =
          error instanceof Error
            ? error.message
            : 'Execution simulation failed.';

        recordAuditEvent(req, {
          eventName:
            AUDIT_EVENTS
              .EXECUTION_SIMULATION_FAILED,
          outcome: 'failure',
          requestId,
          correlationId,
          actor,
          action: 'execution.simulate',
          method: req.method,
          path: req.path,
          statusCode,
          durationMs,
          ...(workflowId
            ? { workflowId }
            : {}),
          ...(executionId
            ? { executionId }
            : {}),
          resource: {
            type: PLUGIN_NAMES.EC2,
            region: executionRegion,
            ...(resourceId
              ? { id: resourceId }
              : {}),
          },
          reason,
          errorCode,
        });

        handleRouteError(
          res,
          error,
          requestId,
          'execution'
        );
      }
    }
  );

  router.get(
    '/verification/reports',
    async (req: Request, res: Response) => {
      const requestId = generateRequestId();

      try {
        const workflowId =
          typeof req.query.workflowId === 'string'
            ? req.query.workflowId
            : undefined;

        if (workflowId) {
          const record =
            deps.learningStore.getByWorkflowId(
              workflowId
            );

          if (!record) {
            throw new AppError(
              'NOT_FOUND',
              `No verification report found for workflow ${workflowId}`,
              404
            );
          }

          const report =
            deps.learningStore
              .listReports()
              .find(
                (item) =>
                  item.workflowId === workflowId
              );

          res.json(
            buildSuccessResponse(
              {
                report,
                configuration:
                  DEFAULT_VERIFICATION_CONFIG,
              },
              requestId
            )
          );

          return;
        }

        const reports =
          deps.learningStore.listReports();

        const total =
          deps.learningStore.listRecords().length;

        res.json(
          buildSuccessResponse(
            {
              reports,
              total,
              configuration:
                DEFAULT_VERIFICATION_CONFIG,
            },
            requestId
          )
        );
      } catch (error) {
        handleRouteError(
          res,
          error,
          requestId,
          'verification'
        );
      }
    }
  );

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

/** Optimization report routes — Sprint 9 Reporting Layer. */
export function createReportRoutes(
  deps: Pick<
    ApiDependencies,
    'orchestrator' | 'reportingEngine'
  >
): Router {
  const router = Router();

  router.get(
    '/reports',
    (req: Request, res: Response) => {
      const requestId = generateRequestId();

      try {
        const filters = parseReportFilters(
          req.query as Record<string, unknown>
        );

        const allReports =
          deps.reportingEngine.listReports();

        const reports = filterReports(
          allReports,
          filters
        );

        res.json(
          buildSuccessResponse(
            {
              reports: reports.map((report) => ({
                reportId: report.reportId,
                workflowId: report.workflowId,
                plugin: report.plugin,
                status: report.status,
                workflowStatus:
                  report.workflowStatus,
                createdAt: report.createdAt,
                region: report.region,
                summary: {
                  headline:
                    report.summary.headline,
                  opportunityCount:
                    report.summary
                      .opportunityCount,
                  estimatedMonthlySavings:
                    report.summary
                      .estimatedMonthlySavings,
                  verifiedMonthlySavings:
                    report.summary
                      .verifiedMonthlySavings,
                  verifiedCount:
                    report.summary
                      .verifiedCount,
                  currency:
                    report.summary.currency,
                  optimizationStatus:
                    report.summary
                      .optimizationStatus,
                  executiveSummary:
                    report.summary
                      .executiveSummary,
                },
                resourceCount:
                  report.resources.length,
                confidenceStatus:
                  report.recommendations[0]
                    ?.decision.confidenceStatus,
                verificationStatus:
                  report.verification?.status,
              })),
              total: reports.length,
              filters,
            },
            requestId
          )
        );
      } catch (error) {
        handleRouteError(
          res,
          error,
          requestId,
          'reports'
        );
      }
    }
  );

  router.get(
    '/reports/:id',
    (req: Request, res: Response) => {
      const requestId = generateRequestId();

      try {
        const reportId = req.params.id;

        const report =
          deps.reportingEngine.getReport(
            reportId
          );

        if (!report) {
          throw new AppError(
            'NOT_FOUND',
            `Report not found: ${reportId}`,
            404
          );
        }

        res.json(
          buildSuccessResponse(
            report,
            requestId
          )
        );
      } catch (error) {
        handleRouteError(
          res,
          error,
          requestId,
          'reports'
        );
      }
    }
  );

  router.post(
    '/reports/generate',
    requireAnyRole(...ANALYSIS_ROLES),
    (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(
        req,
        requestId
      );
      const actor = getAuditActor(req);
      const startedAt = Date.now();

      let reportId: string | undefined;
      let workflowId: string | undefined;

      try {
        workflowId = validateReportGenerateBody(
          req.body
        ).workflowId;

        const existing =
          deps.reportingEngine
            .getReportByWorkflowId(
              workflowId
            );

        if (existing) {
          reportId = existing.reportId;

          recordAuditEvent(req, {
            eventName:
              AUDIT_EVENTS.REPORT_GENERATED,
            outcome: 'success',
            requestId,
            correlationId,
            actor,
            action: 'report.generate',
            method: req.method,
            path: req.path,
            statusCode: 200,
            durationMs:
              Date.now() - startedAt,
            workflowId,
            reportId,
            reason:
              'Existing report returned from cache.',
          });

          res.json(
            buildSuccessResponse(
              {
                report: existing,
                cached: true,
              },
              requestId
            )
          );

          return;
        }

        const record =
          deps.orchestrator.getWorkflow(
            workflowId
          );

        if (!record) {
          throw new AppError(
            'NOT_FOUND',
            `Workflow not found: ${workflowId}`,
            404,
            'reports'
          );
        }

        const input =
          toReportGenerationInput(record);

        const result =
          deps.reportingEngine.execute(input);

        if (!result.success || !result.data) {
          const code =
            result.error?.code ??
            'REPORT_GENERATION_FAILED';

          const message =
            result.error?.reason ??
            'Report generation failed';

          throw new AppError(
            code,
            message,
            422,
            'reports'
          );
        }

        reportId = result.data.reportId;

        recordAuditEvent(req, {
          eventName:
            AUDIT_EVENTS.REPORT_GENERATED,
          outcome: 'success',
          requestId,
          correlationId,
          actor,
          action: 'report.generate',
          method: req.method,
          path: req.path,
          statusCode: 201,
          durationMs:
            Date.now() - startedAt,
          workflowId,
          reportId,
        });

        res.status(201).json(
          buildSuccessResponse(
            {
              report: result.data,
              cached: false,
            },
            requestId
          )
        );
      } catch (error) {
        const statusCode =
          isAppError(error)
            ? error.statusCode
            : 500;

        const errorCode =
          isAppError(error)
            ? error.code
            : 'ENGINE_ERROR';

        const reason =
          error instanceof Error
            ? error.message
            : 'Report generation failed.';

        recordAuditEvent(req, {
          eventName:
            AUDIT_EVENTS
              .REPORT_GENERATION_FAILED,
          outcome: 'failure',
          requestId,
          correlationId,
          actor,
          action: 'report.generate',
          method: req.method,
          path: req.path,
          statusCode,
          durationMs:
            Date.now() - startedAt,
          ...(workflowId
            ? { workflowId }
            : {}),
          ...(reportId
            ? { reportId }
            : {}),
          reason,
          errorCode,
        });

        handleRouteError(
          res,
          error,
          requestId,
          'reports'
        );
      }
    }
  );

  return router;
}

/** Admin audit retrieval routes — Sprint 10.5.14. */
export function createAdminAuditRoutes(): Router {
  const router = Router();

  router.get(
    '/admin/audit-events',
    requireAnyRole(...ADMIN_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(
        req,
        requestId
      );
      const actor = getAuditActor(req);
      const startedAt = Date.now();

      if (!isAuditPersistenceEnabled()) {
        res.status(503).json(
          buildErrorResponse(
            'AUDIT_PERSISTENCE_DISABLED',
            'Audit persistence is disabled in this environment.',
            requestId,
            'audit'
          )
        );
        return;
      }

      try {
        const tenantId = resolveTenantId(actor);

        const filters = parseAuditQueryFilters(
          req.query as Record<string, unknown>,
          tenantId
        );

        const result = await queryAuditEvents(filters);

        writeAuditEvent({
          eventName:
            AUDIT_EVENTS.AUDIT_SEARCH_PERFORMED,
          outcome: 'success',
          requestId,
          correlationId,
          actor,
          action: 'audit.search',
          method: req.method,
          path: req.path,
          statusCode: 200,
          durationMs: Date.now() - startedAt,
          reason: JSON.stringify({
            filters: {
              eventName: filters.eventName,
              outcome: filters.outcome,
              actorUserId: filters.actorUserId,
              workflowId: filters.workflowId,
              requestId: filters.requestId,
              correlationId: filters.correlationId,
              from: filters.from,
              to: filters.to,
              limit: filters.limit,
            },
            resultCount: result.items.length,
          }),
        });

        res.json(
          buildSuccessResponse(
            {
              items: result.items,
              count: result.items.length,
              nextToken: result.nextToken,
              tenantId,
            },
            requestId
          )
        );
      } catch (error) {
        const durationMs = Date.now() - startedAt;

        if (error instanceof AuditQueryValidationError) {
          writeAuditEvent({
            eventName:
              AUDIT_EVENTS.AUDIT_SEARCH_PERFORMED,
            outcome: 'failure',
            requestId,
            correlationId,
            actor,
            action: 'audit.search',
            method: req.method,
            path: req.path,
            statusCode: 400,
            durationMs,
            errorCode: error.code,
            reason: error.message,
          });

          res.status(400).json(
            buildErrorResponse(
              error.code,
              error.message,
              requestId,
              'audit'
            )
          );
          return;
        }

        if (
          error instanceof
          AuditPersistenceUnavailableError
        ) {
          writeAuditEvent({
            eventName:
              AUDIT_EVENTS.AUDIT_SEARCH_PERFORMED,
            outcome: 'failure',
            requestId,
            correlationId,
            actor,
            action: 'audit.search',
            method: req.method,
            path: req.path,
            statusCode: 503,
            durationMs,
            errorCode: 'AUDIT_PERSISTENCE_UNAVAILABLE',
            reason: error.message,
          });

          res.status(503).json(
            buildErrorResponse(
              'AUDIT_PERSISTENCE_UNAVAILABLE',
              error.message,
              requestId,
              'audit'
            )
          );
          return;
        }

        writeAuditEvent({
          eventName:
            AUDIT_EVENTS.AUDIT_SEARCH_PERFORMED,
          outcome: 'failure',
          requestId,
          correlationId,
          actor,
          action: 'audit.search',
          method: req.method,
          path: req.path,
          statusCode: 500,
          durationMs,
          errorCode: 'AUDIT_QUERY_FAILED',
          reason:
            error instanceof Error
              ? error.message
              : 'Audit query failed.',
        });

        handleRouteError(
          res,
          error,
          requestId,
          'audit'
        );
      }
    }
  );

  return router;
}

/** Compose all API v1 routes. */
export function createApiRoutes(deps: ApiDependencies): Router {
  const router = Router();

  // Health remains public for monitoring and deployment smoke tests.
  router.use(createHealthRoutes());

  // All routes below this point require a recognized Cognito role.
  router.use(requireAnyRole(...ALL_AUTHENTICATED_ROLES));

  router.use(createPluginRoutes(deps));
  router.use(createProviderRoutes(deps));
  router.use(createWorkflowRoutes(deps));
  router.use(createGovernanceRoutes());
  router.use(createFinancialRoutes(deps));
  router.use(createRecommendationRoutes(deps));
  router.use(createVerificationRoutes(deps));
  router.use(createReportRoutes(deps));
  router.use(createAdminAuditRoutes());

  return router;
}

export { PROVIDER_NAMES };