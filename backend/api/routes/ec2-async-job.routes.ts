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
import { InvalidPaginationTokenError, RepositoryNotFoundError } from '../../database';
import { resolveRouteTenantContext } from '../tenant-route-helpers';
import { createStandardRateLimit } from '../rate-limit';
import { validateIdempotencyKey } from '../../security';
import { buildErrorResponse, buildSuccessResponse, isAppError } from '../../shared/utils';
import type { MembershipRepository } from '../../repositories/contracts';
import {
  Ec2AsyncJobProducerService,
  Ec2AsyncJobValidationError as ProducerValidationError,
} from '../../services/ec2-async-job-producer-service';
import {
  Ec2AsyncJobApiService,
  sanitizeEc2AsyncJobEventForApi,
} from '../../services/ec2-async-job-api-service';
import {
  Ec2AsyncJobValidationError,
  parseEc2AsyncJobListQuery,
  parseStartEc2AsyncJobBody,
} from '../ec2-async-job-api-validation';

export interface Ec2AsyncJobRouteDeps {
  ec2AsyncJobProducer: Ec2AsyncJobProducerService;
  ec2AsyncJobApi: Ec2AsyncJobApiService;
  membershipRepository: MembershipRepository;
}

const EC2_ASYNC_START_ROLES = [
  TENANT_ROLES.TENANT_OWNER,
  TENANT_ROLES.TENANT_ADMIN,
  TENANT_ROLES.SECURITY_ADMIN,
  TENANT_ROLES.ANALYST,
] as const;

const EC2_ASYNC_READ_ROLES = [
  TENANT_ROLES.TENANT_OWNER,
  TENANT_ROLES.TENANT_ADMIN,
  TENANT_ROLES.SECURITY_ADMIN,
  TENANT_ROLES.ANALYST,
  TENANT_ROLES.VIEWER,
  TENANT_ROLES.AUDITOR,
] as const;

const PUBLIC_INTERNAL_ERROR =
  'The EC2 intelligence job request could not be completed. Try again later.';

function handleEc2AsyncJobRouteError(res: Response, error: unknown, requestId: string): void {
  if (
    error instanceof Ec2AsyncJobValidationError ||
    error instanceof ProducerValidationError
  ) {
    res
      .status(422)
      .json(buildErrorResponse('INVALID_REQUEST', error.message, requestId, 'ec2-async-job-api'));
    return;
  }
  if (error instanceof RepositoryNotFoundError) {
    res
      .status(404)
      .json(buildErrorResponse('NOT_FOUND', error.message, requestId, 'ec2-async-job-api'));
    return;
  }
  if (error instanceof InvalidPaginationTokenError) {
    res
      .status(422)
      .json(buildErrorResponse('INVALID_REQUEST', error.message, requestId, 'ec2-async-job-api'));
    return;
  }
  if (isAppError(error)) {
    res
      .status(error.statusCode)
      .json(buildErrorResponse(error.code, error.message, requestId, error.stage ?? 'ec2-async-job-api'));
    return;
  }
  res
    .status(500)
    .json(
      buildErrorResponse('ENGINE_ERROR', PUBLIC_INTERNAL_ERROR, requestId, 'ec2-async-job-api'),
    );
}

export function createEc2AsyncJobRoutes(deps: Ec2AsyncJobRouteDeps): Router {
  const router = Router();
  const rateLimit = createStandardRateLimit();

  router.post(
    '/analysis/ec2/start',
    rateLimit,
    requireTenantRole(deps.membershipRepository, ...EC2_ASYNC_START_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      try {
        const idempotencyKey = validateIdempotencyKey(
          req.header('Idempotency-Key') ??
            (req.body as Record<string, unknown> | undefined)?.idempotencyKey,
        );
        if (!idempotencyKey) {
          throw new Ec2AsyncJobValidationError('Idempotency-Key header is required.');
        }
        const body = parseStartEc2AsyncJobBody(req.body);
        const result = await deps.ec2AsyncJobProducer.startEc2IntelligenceJob(
          tenantId,
          body,
          { idempotencyKey, correlationId },
        );

        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: result.reused
              ? AUDIT_EVENTS.EC2_ASYNC_JOB_ENQUEUED
              : AUDIT_EVENTS.EC2_ASYNC_JOB_CREATED,
            outcome: 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'ec2.async_job.start',
            method: req.method,
            path: req.path,
            statusCode: 202,
            resource: { type: 'ec2_async_job', id: result.job.jobId, accountId: result.job.accountId },
          }),
        );
        if (!result.reused) {
          scheduleAuditPersistence(
            req,
            writeAuditEvent({
              eventName: AUDIT_EVENTS.EC2_ASYNC_JOB_ENQUEUED,
              outcome: 'success',
              requestId,
              correlationId,
              actor,
              tenantId,
              action: 'ec2.async_job.enqueue',
              method: req.method,
              path: req.path,
              statusCode: 202,
              resource: { type: 'ec2_async_job', id: result.job.jobId, accountId: result.job.accountId },
            }),
          );
        }

        res.status(202).json(
          buildSuccessResponse(
            {
              jobId: result.job.jobId,
              status: result.job.status,
              queueStatus: result.job.queueStatus,
              correlationId: result.job.correlationId,
            },
            requestId,
          ),
        );
      } catch (error) {
        if (isAppError(error) && error.code === 'EC2_ASYNC_JOB_ENQUEUE_FAILED') {
          scheduleAuditPersistence(
            req,
            writeAuditEvent({
              eventName: AUDIT_EVENTS.EC2_ASYNC_JOB_ENQUEUE_FAILED,
              outcome: 'failure',
              requestId,
              correlationId,
              actor,
              tenantId,
              action: 'ec2.async_job.enqueue',
              method: req.method,
              path: req.path,
              statusCode: error.statusCode,
              errorCode: error.code,
            }),
          );
        }
        handleEc2AsyncJobRouteError(res, error, requestId);
      }
    },
  );

  router.get(
    '/analysis/jobs',
    rateLimit,
    requireTenantRole(deps.membershipRepository, ...EC2_ASYNC_READ_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      try {
        const query = parseEc2AsyncJobListQuery(req.query as Record<string, unknown>);
        const page = await deps.ec2AsyncJobApi.listJobs(tenantId, query);
        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: AUDIT_EVENTS.EC2_ASYNC_JOB_LISTED,
            outcome: 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'ec2.async_job.list',
            method: req.method,
            path: req.path,
            statusCode: 200,
          }),
        );
        res.json(
          buildSuccessResponse(
            {
              items: await Promise.all(
                page.items.map((job) => deps.ec2AsyncJobApi.presentJobForApi(job)),
              ),
              nextToken: page.nextToken,
            },
            requestId,
          ),
        );
      } catch (error) {
        handleEc2AsyncJobRouteError(res, error, requestId);
      }
    },
  );

  router.get(
    '/analysis/jobs/:jobId',
    rateLimit,
    requireTenantRole(deps.membershipRepository, ...EC2_ASYNC_READ_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      try {
        const job = await deps.ec2AsyncJobApi.getJob(tenantId, req.params.jobId);
        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: AUDIT_EVENTS.EC2_ASYNC_JOB_VIEWED,
            outcome: 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'ec2.async_job.view',
            method: req.method,
            path: req.path,
            statusCode: 200,
            resource: { type: 'ec2_async_job', id: job.jobId, accountId: job.accountId },
          }),
        );
        res.json(
          buildSuccessResponse(await deps.ec2AsyncJobApi.presentJobForApi(job), requestId),
        );
      } catch (error) {
        handleEc2AsyncJobRouteError(res, error, requestId);
      }
    },
  );

  router.get(
    '/analysis/jobs/:jobId/events',
    rateLimit,
    requireTenantRole(deps.membershipRepository, ...EC2_ASYNC_READ_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      try {
        const query = parseEc2AsyncJobListQuery(req.query as Record<string, unknown>);
        const page = await deps.ec2AsyncJobApi.listEvents(tenantId, req.params.jobId, query);
        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: AUDIT_EVENTS.EC2_ASYNC_JOB_EVENTS_VIEWED,
            outcome: 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'ec2.async_job.events',
            method: req.method,
            path: req.path,
            statusCode: 200,
            resource: { type: 'ec2_async_job', id: req.params.jobId },
          }),
        );
        res.json(
          buildSuccessResponse(
            {
              items: page.items.map(sanitizeEc2AsyncJobEventForApi),
              nextToken: page.nextToken,
            },
            requestId,
          ),
        );
      } catch (error) {
        handleEc2AsyncJobRouteError(res, error, requestId);
      }
    },
  );

  return router;
}
