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
import {
  ANALYSIS_ROLES,
  PRIVILEGED_OPERATIONS,
  requireAnyRole,
  requirePrivilegedMfa,
} from '../../auth';
import { requireExecutionPrivilegedRole } from '../../auth/execution-api-authorization';
import { getAuthenticatedIdentity } from '../../auth/identity';
import {
  buildExecutionApiAuditInput,
} from '../execution-api-audit';
import { resolveRouteTenantContext } from '../tenant-route-helpers';
import {
  ExecutionApiValidationError,
  parseExecutionPlanListQuery,
  parseExecutionRunListQuery,
  validateApprovalBody,
  validateCreateExecutionPlanBody,
  validateExecuteBody,
  validateRejectionBody,
  validateUpdateExecutionPlanBody,
} from '../execution-api-validation';
import { ExecutionPlanValidationError } from '../../repositories/models/execution-persistence-models';
import type { MembershipRepository } from '../../repositories/contracts';
import {
  ExecutionApiService,
  mapExecutionServiceError,
  sanitizeExecutionPlan,
  sanitizeExecutionRun,
} from '../../services/execution-api-service';
import {
  AppError,
  buildErrorResponse,
  buildSuccessResponse,
  isAppError,
} from '../../shared/utils';
import { InvalidPaginationTokenError, RepositoryConflictError, RepositoryNotFoundError } from '../../database';
import {
  InvalidExecutionTransitionError,
} from '../../services/execution-lifecycle';

function handleExecutionCaughtError(
  res: Response,
  error: unknown,
  requestId: string,
): void {
  if (error instanceof ExecutionPlanValidationError) {
    handleExecutionRouteError(
      res,
      new ExecutionApiValidationError(error.message),
      requestId,
    );
    return;
  }

  handleExecutionRouteError(res, error, requestId);
}

export interface ExecutionRouteDeps {
  executionApi: ExecutionApiService;
  membershipRepository: MembershipRepository;
}

function handleExecutionRouteError(
  res: Response,
  error: unknown,
  requestId: string,
): void {
  const mapped = mapExecutionServiceError(error);
  if (mapped instanceof AppError) {
    res
      .status(mapped.statusCode)
      .json(
        buildErrorResponse(
          mapped.code,
          mapped.message,
          requestId,
          mapped.stage,
        ),
      );
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
          'execution-api',
        ),
      );
    return;
  }

  if (error instanceof ExecutionApiValidationError) {
    res
      .status(error.statusCode)
      .json(
        buildErrorResponse(error.code, error.message, requestId, error.stage),
      );
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
          'execution-api',
        ),
      );
    return;
  }

  if (error instanceof RepositoryNotFoundError) {
    res
      .status(404)
      .json(
        buildErrorResponse(
          'NOT_FOUND',
          'Execution plan was not found.',
          requestId,
          'execution-api',
        ),
      );
    return;
  }

  if (error instanceof InvalidExecutionTransitionError) {
    res
      .status(409)
      .json(
        buildErrorResponse('CONFLICT', error.message, requestId, 'execution-api'),
      );
    return;
  }

  if (isAppError(error)) {
    res
      .status(error.statusCode)
      .json(
        buildErrorResponse(error.code, error.message, requestId, error.stage),
      );
    return;
  }

  res
    .status(500)
    .json(
      buildErrorResponse(
        'ENGINE_ERROR',
        'Execution API request failed.',
        requestId,
        'execution-api',
      ),
    );
}

function recordExecutionAudit(
  req: Request,
  input: {
    eventName: AuditEventName;
    outcome: 'success' | 'failure' | 'started' | 'denied';
    action: string;
    statusCode: number;
    planId?: string;
    workflowId?: string;
    runId?: string;
    runRegion?: string;
    priorStatus?: string;
    newStatus?: string;
    errorCode?: string;
    reason?: string;
  },
): void {
  const requestId = getRequestId(req);
  const correlationId = getCorrelationId(req, requestId);
  const actor = getAuditActor(req);
  const tenantId = resolveRouteTenantContext(req).tenantId;

  const event = writeAuditEvent(
    buildExecutionApiAuditInput({
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
      planId: input.planId,
      workflowId: input.workflowId,
      runId: input.runId,
      runRegion: input.runRegion,
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

export function createExecutionRoutes(deps: ExecutionRouteDeps): Router {
  const router = Router();
  const privileged = [
    requireExecutionPrivilegedRole(deps.membershipRepository),
  ];

  router.post(
    '/execution/plans',
    requireAnyRole(...ANALYSIS_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      try {
        const body = validateCreateExecutionPlanBody(req.body);
        const created = await deps.executionApi.createPlan(actorContext(req), body);
        recordExecutionAudit(req, {
          eventName: AUDIT_EVENTS.EXECUTION_PLAN_CREATED,
          outcome: 'success',
          action: 'execution.plan.create',
          statusCode: 201,
          planId: created.executionId,
          workflowId: created.workflowId,
          newStatus: created.planStatus,
        });
        res
          .status(201)
          .json(buildSuccessResponse(sanitizeExecutionPlan(created), requestId));
      } catch (error) {
        handleExecutionCaughtError(res, error, requestId);
      }
    },
  );

  router.get(
    '/execution/plans',
    requireAnyRole(...ANALYSIS_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      try {
        const tenantId = resolveRouteTenantContext(req).tenantId;
        const query = parseExecutionPlanListQuery(
          req.query as Record<string, unknown>,
        );
        const page = await deps.executionApi.listPlans(tenantId, query);
        res.json(
          buildSuccessResponse(
            {
              items: page.items.map(sanitizeExecutionPlan),
              nextToken: page.nextToken,
            },
            requestId,
          ),
        );
      } catch (error) {
        handleExecutionRouteError(res, error, requestId);
      }
    },
  );

  router.get(
    '/execution/plans/:planId',
    requireAnyRole(...ANALYSIS_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      try {
        const tenantId = resolveRouteTenantContext(req).tenantId;
        const plan = await deps.executionApi.getPlan(tenantId, req.params.planId);
        if (!plan) {
          res
            .status(404)
            .json(
              buildErrorResponse(
                'NOT_FOUND',
                'Execution plan was not found.',
                requestId,
                'execution-api',
              ),
            );
          return;
        }
        res.json(buildSuccessResponse(sanitizeExecutionPlan(plan), requestId));
      } catch (error) {
        handleExecutionRouteError(res, error, requestId);
      }
    },
  );

  router.patch(
    '/execution/plans/:planId',
    requireAnyRole(...ANALYSIS_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      try {
        const body = validateUpdateExecutionPlanBody(req.body);
        const updated = await deps.executionApi.updatePlan(
          actorContext(req),
          req.params.planId,
          body,
        );
        recordExecutionAudit(req, {
          eventName: AUDIT_EVENTS.EXECUTION_PLAN_UPDATED,
          outcome: 'success',
          action: 'execution.plan.update',
          statusCode: 200,
          planId: updated.executionId,
          workflowId: updated.workflowId,
          newStatus: updated.planStatus,
        });
        res.json(buildSuccessResponse(sanitizeExecutionPlan(updated), requestId));
      } catch (error) {
        handleExecutionCaughtError(res, error, requestId);
      }
    },
  );

  router.post(
    '/execution/plans/:planId/approve',
    ...privileged,
    requirePrivilegedMfa(PRIVILEGED_OPERATIONS.EXECUTION_APPROVE),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      try {
        const { expectedVersion } = validateApprovalBody(req.body);
        const approved = await deps.executionApi.approvePlan(
          actorContext(req),
          req.params.planId,
          expectedVersion,
        );
        recordExecutionAudit(req, {
          eventName: AUDIT_EVENTS.EXECUTION_APPROVED,
          outcome: 'success',
          action: 'execution.plan.approve',
          statusCode: 200,
          planId: approved.executionId,
          workflowId: approved.workflowId,
          newStatus: approved.planStatus,
        });
        res.json(buildSuccessResponse(sanitizeExecutionPlan(approved), requestId));
      } catch (error) {
        handleExecutionRouteError(res, error, requestId);
      }
    },
  );

  router.post(
    '/execution/plans/:planId/reject',
    ...privileged,
    requirePrivilegedMfa(PRIVILEGED_OPERATIONS.EXECUTION_REJECT),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      try {
        const { expectedVersion, rejectionReason } = validateRejectionBody(req.body);
        const rejected = await deps.executionApi.rejectPlan(
          actorContext(req),
          req.params.planId,
          expectedVersion,
          rejectionReason,
        );
        recordExecutionAudit(req, {
          eventName: AUDIT_EVENTS.EXECUTION_REJECTED,
          outcome: 'success',
          action: 'execution.plan.reject',
          statusCode: 200,
          planId: rejected.executionId,
          workflowId: rejected.workflowId,
          newStatus: rejected.planStatus,
          reason: rejectionReason,
        });
        res.json(buildSuccessResponse(sanitizeExecutionPlan(rejected), requestId));
      } catch (error) {
        handleExecutionRouteError(res, error, requestId);
      }
    },
  );

  router.post(
    '/execution/plans/:planId/execute',
    ...privileged,
    requirePrivilegedMfa(PRIVILEGED_OPERATIONS.EXECUTION_EXECUTE),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      try {
        const { expectedVersion, region } = validateExecuteBody(req.body);
        const outcome = await deps.executionApi.executePlan(
          actorContext(req),
          req.params.planId,
          expectedVersion,
          region,
        );

        const success = outcome.result.status === 'SUCCEEDED';
        recordExecutionAudit(req, {
          eventName: success
            ? AUDIT_EVENTS.EXECUTION_EXECUTED
            : AUDIT_EVENTS.EXECUTION_EXECUTION_FAILED,
          outcome: success ? 'success' : 'failure',
          action: 'execution.plan.execute',
          statusCode: 200,
          planId: outcome.plan.executionId,
          workflowId: outcome.plan.workflowId,
          runId: outcome.result.runId,
          runRegion: outcome.run?.region,
          newStatus: outcome.plan.planStatus,
          errorCode: outcome.result.failure?.code,
        });

        res.json(
          buildSuccessResponse(
            {
              plan: sanitizeExecutionPlan(outcome.plan),
              run: outcome.run ? sanitizeExecutionRun(outcome.run) : undefined,
              orchestrationStatus: outcome.result.status,
              failureCode: outcome.result.failure?.code,
            },
            requestId,
          ),
        );
      } catch (error) {
        recordExecutionAudit(req, {
          eventName: AUDIT_EVENTS.EXECUTION_EXECUTION_FAILED,
          outcome: 'failure',
          action: 'execution.plan.execute',
          statusCode: isAppError(error) ? error.statusCode : 500,
          planId: req.params.planId,
          errorCode: isAppError(error) ? error.code : 'ENGINE_ERROR',
        });
        handleExecutionRouteError(res, error, requestId);
      }
    },
  );

  router.post(
    '/execution/plans/:planId/rollback',
    ...privileged,
    requirePrivilegedMfa(PRIVILEGED_OPERATIONS.EXECUTION_ROLLBACK),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      try {
        const { expectedVersion } = validateExecuteBody(req.body);
        const outcome = await deps.executionApi.rollbackPlan(
          actorContext(req),
          req.params.planId,
          expectedVersion,
        );

        if (outcome.rollbackRequested) {
          recordExecutionAudit(req, {
            eventName: AUDIT_EVENTS.EXECUTION_ROLLBACK_REQUESTED,
            outcome: 'started',
            action: 'execution.plan.rollback',
            statusCode: 200,
            planId: outcome.plan.executionId,
            workflowId: outcome.plan.workflowId,
            runId: outcome.result.runId,
            runRegion: outcome.run?.region,
          });
        }

        recordExecutionAudit(req, {
          eventName: AUDIT_EVENTS.EXECUTION_ROLLED_BACK,
          outcome: 'success',
          action: 'execution.plan.rollback',
          statusCode: 200,
          planId: outcome.plan.executionId,
          workflowId: outcome.plan.workflowId,
          runId: outcome.result.runId,
          runRegion: outcome.run?.region,
          newStatus: outcome.plan.planStatus,
        });

        res.json(
          buildSuccessResponse(
            {
              plan: sanitizeExecutionPlan(outcome.plan),
              run: outcome.run ? sanitizeExecutionRun(outcome.run) : undefined,
              orchestrationStatus: 'ROLLED_BACK',
            },
            requestId,
          ),
        );
      } catch (error) {
        if (
          isAppError(error) &&
          error.code === 'EXECUTION_ROLLBACK_FAILED'
        ) {
          recordExecutionAudit(req, {
            eventName: AUDIT_EVENTS.EXECUTION_ROLLBACK_FAILED,
            outcome: 'failure',
            action: 'execution.plan.rollback',
            statusCode: error.statusCode,
            planId: req.params.planId,
            errorCode: error.code,
          });
        }
        handleExecutionRouteError(res, error, requestId);
      }
    },
  );

  router.get(
    '/execution/plans/:planId/status',
    requireAnyRole(...ANALYSIS_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      try {
        const tenantId = resolveRouteTenantContext(req).tenantId;
        const status = await deps.executionApi.getStatus(tenantId, req.params.planId);
        res.json(
          buildSuccessResponse(
            {
              planId: status.plan.executionId,
              planStatus: status.plan.planStatus,
              approvalStatus: status.plan.approvalStatus,
              version: status.plan.version,
              runId:
                typeof status.plan.metadata?.lastRunId === 'string'
                  ? status.plan.metadata.lastRunId
                  : undefined,
              runStatus: status.run?.status,
              rollbackEligible: status.run?.rollbackState.eligible,
              failureCode: status.run?.failure?.code,
              rollbackFailureCode: status.run?.rollbackFailure?.code,
              updatedAt: status.plan.updatedAt,
            },
            requestId,
          ),
        );
      } catch (error) {
        handleExecutionRouteError(res, error, requestId);
      }
    },
  );

  router.get(
    '/execution/runs',
    requireAnyRole(...ANALYSIS_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      try {
        const tenantId = resolveRouteTenantContext(req).tenantId;
        const query = parseExecutionRunListQuery(req.query as Record<string, unknown>);
        const page = await deps.executionApi.listRuns(tenantId, query);
        res.json(
          buildSuccessResponse(
            {
              items: page.items.map(sanitizeExecutionRun),
              nextToken: page.nextToken,
            },
            requestId,
          ),
        );
      } catch (error) {
        handleExecutionRouteError(res, error, requestId);
      }
    },
  );

  router.get(
    '/execution/runs/:runId',
    requireAnyRole(...ANALYSIS_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      try {
        const tenantId = resolveRouteTenantContext(req).tenantId;
        const run = await deps.executionApi.getRun(tenantId, req.params.runId);
        if (!run) {
          res
            .status(404)
            .json(
              buildErrorResponse(
                'NOT_FOUND',
                'Execution run was not found.',
                requestId,
                'execution-api',
              ),
            );
          return;
        }
        res.json(buildSuccessResponse(sanitizeExecutionRun(run), requestId));
      } catch (error) {
        handleExecutionRouteError(res, error, requestId);
      }
    },
  );

  return router;
}
