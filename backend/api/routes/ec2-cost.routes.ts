import { Router, type Request, type Response } from 'express';

import {
  AUDIT_EVENTS,
  getAuditActor,
  getCorrelationId,
  getRequestId,
  scheduleAuditPersistence,
  writeAuditEvent,
} from '../../audit';
import { TENANT_ROLES, requireTenantRole } from '../../auth';
import {
  InvalidPaginationTokenError,
  RepositoryConflictError,
  RepositoryNotFoundError,
} from '../../database';
import { resolveRouteTenantContext } from '../tenant-route-helpers';
import { createStandardRateLimit } from '../rate-limit';
import {
  Ec2CostAnalysisApiService,
  Ec2CostValidationError,
} from '../../services/ec2-cost-analysis-api-service';
import type { MembershipRepository } from '../../repositories/contracts';
import {
  buildErrorResponse,
  buildSuccessResponse,
  isAppError,
} from '../../shared/utils';
import {
  parseEc2CostAnalysisBody,
  parseEc2CostRecommendationListQuery,
} from '../ec2-cost-api-validation';
import { parseEc2CostRecommendationId, parseEc2CostAccountId } from '../ec2-cost-request-validators';
import {
  aggregateEc2CostSavingsSummary,
  sanitizeEc2CostRecommendationForApi,
} from '../../cloud-intelligence/ec2-cost/ec2-cost-pricing-policy';
import {
  EC2_COST_PUBLIC_INTERNAL_ERROR_MESSAGE,
  logEc2CostInternalFailure,
  resolveEc2CostAuditErrorCode,
  type Ec2CostInternalErrorLogContext,
} from '../ec2-cost-api-error-handling';

export interface Ec2CostRouteDeps {
  ec2CostAnalysisApi: Ec2CostAnalysisApiService;
  membershipRepository: MembershipRepository;
}

const EC2_COST_READ_ROLES = [
  TENANT_ROLES.TENANT_OWNER,
  TENANT_ROLES.TENANT_ADMIN,
  TENANT_ROLES.ANALYST,
  TENANT_ROLES.VIEWER,
  TENANT_ROLES.AUDITOR,
] as const;

const EC2_COST_ANALYSIS_ROLES = [
  TENANT_ROLES.TENANT_OWNER,
  TENANT_ROLES.TENANT_ADMIN,
  TENANT_ROLES.ANALYST,
] as const;

function handleEc2CostRouteError(
  res: Response,
  error: unknown,
  requestId: string,
  logContext?: Ec2CostInternalErrorLogContext,
): void {
  if (error instanceof Ec2CostValidationError) {
    res
      .status(422)
      .json(buildErrorResponse('INVALID_REQUEST', error.message, requestId, 'ec2-cost-api'));
    return;
  }
  if (error instanceof RepositoryNotFoundError) {
    res
      .status(404)
      .json(buildErrorResponse('NOT_FOUND', error.message, requestId, 'ec2-cost-api'));
    return;
  }
  if (error instanceof RepositoryConflictError) {
    res
      .status(409)
      .json(
        buildErrorResponse(
          'CONFLICT',
          'Resource version conflict.',
          requestId,
          'ec2-cost-api',
        ),
      );
    return;
  }
  if (error instanceof InvalidPaginationTokenError) {
    res
      .status(422)
      .json(
        buildErrorResponse(
          'INVALID_REQUEST',
          'Pagination token is invalid or not valid for this list.',
          requestId,
          'ec2-cost-api',
        ),
      );
    return;
  }
  if (isAppError(error)) {
    res
      .status(error.statusCode)
      .json(
        buildErrorResponse(error.code, error.message, requestId, error.stage ?? 'ec2-cost-api'),
      );
    return;
  }

  if (logContext) {
    logEc2CostInternalFailure(logContext, error);
  }
  res
    .status(500)
    .json(
      buildErrorResponse(
        'ENGINE_ERROR',
        EC2_COST_PUBLIC_INTERNAL_ERROR_MESSAGE,
        requestId,
        'ec2-cost-api',
      ),
    );
}

export function createEc2CostRoutes(deps: Ec2CostRouteDeps): Router {
  const router = Router();
  router.use(createStandardRateLimit());

  router.post(
    '/analysis/ec2/cost',
    requireTenantRole(deps.membershipRepository, ...EC2_COST_ANALYSIS_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;

      scheduleAuditPersistence(
        req,
        writeAuditEvent({
          eventName: AUDIT_EVENTS.EC2_COST_ANALYSIS_STARTED,
          outcome: 'started',
          requestId,
          correlationId,
          actor,
          tenantId,
          action: 'ec2.cost_analysis',
          method: req.method,
          path: req.path,
          statusCode: 200,
        }),
      );

      try {
        const body = parseEc2CostAnalysisBody(req.body);
        const result = await deps.ec2CostAnalysisApi.startCostAnalysis(tenantId, body, {
          actor,
          requestId,
          correlationId,
        });

        const eventName =
          result.status === 'SUCCEEDED'
            ? AUDIT_EVENTS.EC2_COST_ANALYSIS_SUCCEEDED
            : result.status === 'PARTIAL'
              ? AUDIT_EVENTS.EC2_COST_ANALYSIS_PARTIAL
              : AUDIT_EVENTS.EC2_COST_ANALYSIS_FAILED;

        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName,
            outcome: result.status === 'FAILED' ? 'failure' : 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'ec2.cost_analysis',
            method: req.method,
            path: req.path,
            statusCode: 200,
            resource: {
              type: 'ec2_cost_analysis_run',
              id: result.runId,
              accountId: result.accountId,
            },
            reason: `instancesEvaluated=${result.instancesEvaluated}`,
          }),
        );

        res.status(200).json(buildSuccessResponse(result, requestId));
      } catch (error) {
        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: AUDIT_EVENTS.EC2_COST_ANALYSIS_FAILED,
            outcome: 'failure',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'ec2.cost_analysis',
            method: req.method,
            path: req.path,
            statusCode: isAppError(error) ? error.statusCode : 500,
            errorCode: resolveEc2CostAuditErrorCode(error),
          }),
        );
        handleEc2CostRouteError(res, error, requestId, {
          requestId,
          correlationId,
          tenantId,
          operation: 'ec2.cost_analysis',
          method: req.method,
          path: req.path,
        });
      }
    },
  );

  router.get(
    '/recommendations/ec2/cost',
    requireTenantRole(deps.membershipRepository, ...EC2_COST_READ_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      try {
        const query = parseEc2CostRecommendationListQuery(tenantId, req.query as Record<string, unknown>);
        const page = await deps.ec2CostAnalysisApi.listRecommendations(query);
        const items = page.items.map(sanitizeEc2CostRecommendationForApi);
        const savingsSummary = aggregateEc2CostSavingsSummary(page.items);

        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: AUDIT_EVENTS.EC2_COST_RECOMMENDATIONS_LISTED,
            outcome: 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'ec2.cost_recommendations.list',
            method: req.method,
            path: req.path,
            statusCode: 200,
            resource: { type: 'aws_account', id: query.accountId, accountId: query.accountId },
          }),
        );

        res.json(
          buildSuccessResponse(
            {
              items,
              nextToken: page.nextToken,
              savingsSummary,
            },
            requestId,
          ),
        );
      } catch (error) {
        handleEc2CostRouteError(res, error, requestId, {
          requestId,
          correlationId,
          tenantId,
          operation: 'ec2.cost_recommendations.list',
          method: req.method,
          path: req.path,
        });
      }
    },
  );

  router.get(
    '/recommendations/ec2/cost/:recommendationId',
    requireTenantRole(deps.membershipRepository, ...EC2_COST_READ_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      try {
        const accountId = req.query.accountId;
        if (typeof accountId !== 'string') {
          throw new Ec2CostValidationError('accountId query parameter is required.');
        }
        const normalizedAccountId = parseEc2CostAccountId(accountId);
        const recommendationId = parseEc2CostRecommendationId(req.params.recommendationId);
        const record = await deps.ec2CostAnalysisApi.getRecommendation(
          tenantId,
          normalizedAccountId,
          recommendationId,
        );

        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: AUDIT_EVENTS.EC2_COST_RECOMMENDATION_VIEWED,
            outcome: 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'ec2.cost_recommendation.view',
            method: req.method,
            path: req.path,
            statusCode: 200,
            resource: {
              type: 'ec2_cost_recommendation',
              id: record.recommendationId,
              accountId: record.accountId,
            },
          }),
        );

        res.json(buildSuccessResponse(sanitizeEc2CostRecommendationForApi(record), requestId));
      } catch (error) {
        handleEc2CostRouteError(res, error, requestId, {
          requestId,
          correlationId,
          tenantId,
          operation: 'ec2.cost_recommendation.view',
          method: req.method,
          path: req.path,
        });
      }
    },
  );

  return router;
}
