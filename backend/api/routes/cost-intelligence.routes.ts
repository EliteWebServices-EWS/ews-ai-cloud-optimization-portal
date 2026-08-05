import { Router, type Request, type Response } from 'express';

import {
  AUDIT_EVENTS,
  getAuditActor,
  getCorrelationId,
  getRequestId,
  scheduleAuditPersistence,
  writeAuditEvent,
  type AuditEventName,
} from '../../audit';
import { ANALYSIS_ROLES, requireAnyRole } from '../../auth';
import { getAuthenticatedIdentity } from '../../auth/identity';
import { buildCostIntelligenceApiAuditInput } from '../cost-intelligence-api-audit';
import {
  CostIntelligenceApiValidationError,
  parseCostFindingListQuery,
  validateRunCostAnalysisBody,
  validateUpdateFindingStatusBody,
} from '../cost-intelligence-api-validation';
import { resolveRouteTenantContext } from '../tenant-route-helpers';
import { InvalidPaginationTokenError, RepositoryConflictError, RepositoryNotFoundError } from '../../database';
import {
  CostIntelligenceApiService,
  mapCostIntelligenceServiceError,
} from '../../services/cost-intelligence-api-service';
import { AppError, buildErrorResponse, buildSuccessResponse } from '../../shared/utils';

export interface CostIntelligenceRouteDeps {
  costIntelligenceApi: CostIntelligenceApiService;
}

function handleCostIntelligenceRouteError(
  res: Response,
  error: unknown,
  requestId: string,
): void {
  const mapped = mapCostIntelligenceServiceError(error);
  if (mapped instanceof AppError) {
    res
      .status(mapped.statusCode)
      .json(buildErrorResponse(mapped.code, mapped.message, requestId, mapped.stage));
    return;
  }

  if (error instanceof CostIntelligenceApiValidationError) {
    res
      .status(error.statusCode)
      .json(buildErrorResponse(error.code, error.message, requestId, error.stage));
    return;
  }

  if (error instanceof InvalidPaginationTokenError) {
    res
      .status(422)
      .json(
        buildErrorResponse(
          'INVALID_REQUEST',
          'Pagination token is invalid or not valid for this tenant.',
          requestId,
          'cost-intelligence-api',
        ),
      );
    return;
  }

  if (error instanceof RepositoryConflictError) {
    res
      .status(409)
      .json(
        buildErrorResponse('CONFLICT', 'Resource version conflict.', requestId, 'cost-intelligence-api'),
      );
    return;
  }

  if (error instanceof RepositoryNotFoundError) {
    res
      .status(404)
      .json(
        buildErrorResponse('NOT_FOUND', 'Cost finding was not found.', requestId, 'cost-intelligence-api'),
      );
    return;
  }

  res
    .status(500)
    .json(
      buildErrorResponse(
        'ENGINE_ERROR',
        'Cost intelligence API request failed.',
        requestId,
        'cost-intelligence-api',
      ),
    );
}

function recordCostIntelligenceAudit(
  req: Request,
  input: {
    eventName: AuditEventName;
    outcome: 'success' | 'failure' | 'started' | 'denied';
    action: string;
    statusCode: number;
    accountId?: string;
    analysisId?: string;
    findingId?: string;
    region?: string;
    errorCode?: string;
    reason?: string;
  },
): void {
  const requestId = getRequestId(req);
  const correlationId = getCorrelationId(req, requestId);
  const actor = getAuditActor(req);
  const tenantId = resolveRouteTenantContext(req).tenantId;

  const event = writeAuditEvent(
    buildCostIntelligenceApiAuditInput({
      eventName: input.eventName,
      outcome: input.outcome,
      requestId,
      correlationId,
      actor,
      tenantId,
      action: input.action,
      method: req.method,
      path: req.path,
      statusCode: input.statusCode,
      accountId: input.accountId,
      analysisId: input.analysisId,
      findingId: input.findingId,
      region: input.region,
      errorCode: input.errorCode,
      reason: input.reason,
    }),
  );

  scheduleAuditPersistence(req, event);
}

function actorContext(req: Request) {
  const requestId = getRequestId(req);
  const correlationId = getCorrelationId(req, requestId);
  const tenantId = resolveRouteTenantContext(req).tenantId;
  const identity = getAuthenticatedIdentity(req);

  return {
    tenantId,
    actorId: identity.userId ?? 'unknown',
    actor: getAuditActor(req),
    requestId,
    correlationId,
  };
}

/**
 * EC2 Cost Intelligence routes (Sprint 15).
 *
 * POST   /analysis/ec2/cost                   — run a new analysis for one AWS account
 * GET    /analysis/ec2/cost                   — list findings for the tenant (optionally filtered by accountId)
 * GET    /analysis/ec2/cost/:findingId        — fetch one finding
 * PATCH  /analysis/ec2/cost/:findingId/status — acknowledge/resolve/dismiss a finding
 */
export function createCostIntelligenceRoutes(deps: CostIntelligenceRouteDeps): Router {
  const router = Router();

  router.post(
    '/analysis/ec2/cost',
    requireAnyRole(...ANALYSIS_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      try {
        const body = validateRunCostAnalysisBody(req.body);
        const context = actorContext(req);

        recordCostIntelligenceAudit(req, {
          eventName: AUDIT_EVENTS.COST_INTELLIGENCE_ANALYSIS_STARTED,
          outcome: 'started',
          action: 'cost_intelligence.analysis.start',
          statusCode: 202,
          accountId: body.accountId,
        });

        const report = await deps.costIntelligenceApi.runAnalysis(body.accountId, context);

        recordCostIntelligenceAudit(req, {
          eventName: AUDIT_EVENTS.COST_INTELLIGENCE_ANALYSIS_COMPLETED,
          outcome: 'success',
          action: 'cost_intelligence.analysis.complete',
          statusCode: 200,
          accountId: report.accountId,
          analysisId: report.analysisId,
          region: report.region,
        });

        res.status(200).json(buildSuccessResponse(report, requestId));
      } catch (error) {
        const mapped = error instanceof AppError ? error : mapCostIntelligenceServiceError(error);
        recordCostIntelligenceAudit(req, {
          eventName: AUDIT_EVENTS.COST_INTELLIGENCE_ANALYSIS_FAILED,
          outcome: 'failure',
          action: 'cost_intelligence.analysis.fail',
          statusCode: mapped instanceof AppError ? mapped.statusCode : 500,
          accountId:
            typeof req.body === 'object' && req.body
              ? ((req.body as Record<string, unknown>).accountId as string | undefined)
              : undefined,
          errorCode: mapped instanceof AppError ? mapped.code : 'ENGINE_ERROR',
          reason: mapped instanceof Error ? mapped.message : undefined,
        });
        handleCostIntelligenceRouteError(res, error, requestId);
      }
    },
  );

  router.get(
    '/analysis/ec2/cost',
    requireAnyRole(...ANALYSIS_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      try {
        const tenantId = resolveRouteTenantContext(req).tenantId;
        const query = parseCostFindingListQuery(req.query as Record<string, unknown>);
        const page = await deps.costIntelligenceApi.listFindings(
          tenantId,
          { limit: query.limit, nextToken: query.nextToken },
          query.accountId,
        );
        res.json(buildSuccessResponse({ items: page.items, nextToken: page.nextToken }, requestId));
      } catch (error) {
        handleCostIntelligenceRouteError(res, error, requestId);
      }
    },
  );

  router.get(
    '/analysis/ec2/cost/:findingId',
    requireAnyRole(...ANALYSIS_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      try {
        const tenantId = resolveRouteTenantContext(req).tenantId;
        const finding = await deps.costIntelligenceApi.getFinding(tenantId, req.params.findingId);
        if (!finding) {
          res
            .status(404)
            .json(
              buildErrorResponse(
                'NOT_FOUND',
                'Cost finding was not found.',
                requestId,
                'cost-intelligence-api',
              ),
            );
          return;
        }
        res.json(buildSuccessResponse(finding, requestId));
      } catch (error) {
        handleCostIntelligenceRouteError(res, error, requestId);
      }
    },
  );

  router.patch(
    '/analysis/ec2/cost/:findingId/status',
    requireAnyRole(...ANALYSIS_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      try {
        const tenantId = resolveRouteTenantContext(req).tenantId;
        const body = validateUpdateFindingStatusBody(req.body);
        const updated = await deps.costIntelligenceApi.updateFindingStatus(
          tenantId,
          req.params.findingId,
          body.status,
          { expectedVersion: body.expectedVersion },
        );

        recordCostIntelligenceAudit(req, {
          eventName: AUDIT_EVENTS.COST_INTELLIGENCE_FINDING_STATUS_UPDATED,
          outcome: 'success',
          action: 'cost_intelligence.finding.status_update',
          statusCode: 200,
          findingId: updated.findingId,
          accountId: updated.accountId,
        });

        res.json(buildSuccessResponse(updated, requestId));
      } catch (error) {
        handleCostIntelligenceRouteError(res, error, requestId);
      }
    },
  );

  return router;
}
