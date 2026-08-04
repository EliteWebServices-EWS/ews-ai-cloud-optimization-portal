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
  Ec2DiscoveryApiService,
  Ec2DiscoveryValidationError,
} from '../../services/ec2-discovery-api-service';
import type { MembershipRepository } from '../../repositories/contracts';
import {
  buildErrorResponse,
  buildSuccessResponse,
  isAppError,
} from '../../shared/utils';
import {
  parseEc2DiscoveryBody,
  parseEc2ResourceListQuery,
} from '../ec2-api-validation';
import type { Ec2ResourceType } from '../../repositories/models/cloud-resource-persistence-models';
import {
  EC2_PUBLIC_INTERNAL_ERROR_MESSAGE,
  logEc2InternalFailure,
  resolveEc2AuditErrorCode,
  type Ec2InternalErrorLogContext,
} from '../ec2-api-error-handling';

export interface Ec2RouteDeps {
  ec2DiscoveryApi: Ec2DiscoveryApiService;
  membershipRepository: MembershipRepository;
}

const EC2_READ_ROLES = [
  TENANT_ROLES.TENANT_OWNER,
  TENANT_ROLES.TENANT_ADMIN,
  TENANT_ROLES.SECURITY_ADMIN,
  TENANT_ROLES.VIEWER,
] as const;

const EC2_DISCOVERY_ROLES = [
  TENANT_ROLES.TENANT_OWNER,
  TENANT_ROLES.TENANT_ADMIN,
  TENANT_ROLES.SECURITY_ADMIN,
] as const;

function handleEc2RouteError(
  res: Response,
  error: unknown,
  requestId: string,
  logContext?: Ec2InternalErrorLogContext,
): void {
  if (error instanceof Ec2DiscoveryValidationError) {
    res
      .status(422)
      .json(buildErrorResponse('INVALID_REQUEST', error.message, requestId, 'ec2-api'));
    return;
  }
  if (error instanceof RepositoryNotFoundError) {
    res
      .status(404)
      .json(buildErrorResponse('NOT_FOUND', error.message, requestId, 'ec2-api'));
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
          'ec2-api',
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
          'ec2-api',
        ),
      );
    return;
  }
  if (isAppError(error)) {
    res
      .status(error.statusCode)
      .json(buildErrorResponse(error.code, error.message, requestId, error.stage ?? 'ec2-api'));
    return;
  }

  if (logContext) {
    logEc2InternalFailure(logContext, error);
  }
  res
    .status(500)
    .json(
      buildErrorResponse(
        'ENGINE_ERROR',
        EC2_PUBLIC_INTERNAL_ERROR_MESSAGE,
        requestId,
        'ec2-api',
      ),
    );
}

export function createEc2Routes(deps: Ec2RouteDeps): Router {
  const router = Router();
  router.use(createStandardRateLimit());

  router.post(
    '/aws-accounts/:accountId/ec2/discovery',
    requireTenantRole(deps.membershipRepository, ...EC2_DISCOVERY_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      const accountId = req.params.accountId;

      scheduleAuditPersistence(
        req,
        writeAuditEvent({
          eventName: AUDIT_EVENTS.EC2_DISCOVERY_STARTED,
          outcome: 'started',
          requestId,
          correlationId,
          actor,
          tenantId,
          action: 'ec2.discovery',
          method: req.method,
          path: req.path,
          statusCode: 200,
          resource: { type: 'aws_account', id: accountId, accountId },
        }),
      );

      try {
        const body = parseEc2DiscoveryBody(req.body);
        const result = await deps.ec2DiscoveryApi.startDiscovery(
          tenantId,
          accountId,
          body,
          { actor, requestId, correlationId },
        );

        const eventName =
          result.status === 'SUCCEEDED'
            ? AUDIT_EVENTS.EC2_DISCOVERY_SUCCEEDED
            : result.status === 'PARTIAL'
              ? AUDIT_EVENTS.EC2_DISCOVERY_PARTIAL
              : AUDIT_EVENTS.EC2_DISCOVERY_FAILED;

        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName,
            outcome: result.status === 'FAILED' ? 'failure' : 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'ec2.discovery',
            method: req.method,
            path: req.path,
            statusCode: 200,
            resource: {
              type: 'ec2_discovery_run',
              id: result.runId,
              accountId: result.accountId,
            },
            reason: `regions=${result.regions.join(',')}`,
          }),
        );

        res.status(200).json(buildSuccessResponse(result, requestId));
      } catch (error) {
        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: AUDIT_EVENTS.EC2_DISCOVERY_FAILED,
            outcome: 'failure',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'ec2.discovery',
            method: req.method,
            path: req.path,
            statusCode: isAppError(error) ? error.statusCode : 500,
            resource: { type: 'aws_account', id: accountId, accountId },
            errorCode: resolveEc2AuditErrorCode(error),
          }),
        );
        handleEc2RouteError(res, error, requestId, {
          requestId,
          correlationId,
          tenantId,
          accountId,
          operation: 'ec2.discovery',
          method: req.method,
          path: req.path,
        });
      }
    },
  );

  router.get(
    '/ec2/resources/summary',
    requireTenantRole(deps.membershipRepository, ...EC2_READ_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      try {
        const query = parseEc2ResourceListQuery(req.query, tenantId, { requireAccountId: true });
        const summary = await deps.ec2DiscoveryApi.getSummary(tenantId, query.accountId);
        res.json(buildSuccessResponse(summary, requestId));
      } catch (error) {
        handleEc2RouteError(res, error, requestId, {
          requestId,
          tenantId,
          operation: 'ec2.resources.summary',
          method: req.method,
          path: req.path,
        });
      }
    },
  );

  router.get(
    '/ec2/resources/:resourceType/:resourceId',
    requireTenantRole(deps.membershipRepository, ...EC2_READ_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      try {
        const query = parseEc2ResourceListQuery(req.query, tenantId, { requireAccountId: true });
        const region = String(req.query.region ?? '');
        if (!region.trim()) {
          throw new Ec2DiscoveryValidationError('Query parameter region is required.');
        }
        const resourceType = req.params.resourceType as Ec2ResourceType;
        const resource = await deps.ec2DiscoveryApi.getResource({
          tenantId,
          accountId: query.accountId,
          region,
          resourceType,
          resourceId: req.params.resourceId,
        });

        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: AUDIT_EVENTS.EC2_RESOURCE_VIEWED,
            outcome: 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'ec2.resource_view',
            method: req.method,
            path: req.path,
            statusCode: 200,
            resource: {
              type: 'ec2_resource',
              id: resource.resourceId,
              accountId: query.accountId,
              region: resource.region,
            },
          }),
        );

        res.json(buildSuccessResponse(resource, requestId));
      } catch (error) {
        const queryAccountId =
          typeof req.query.accountId === 'string' ? req.query.accountId : undefined;
        handleEc2RouteError(res, error, requestId, {
          requestId,
          correlationId,
          tenantId,
          accountId: queryAccountId,
          operation: 'ec2.resource_view',
          method: req.method,
          path: req.path,
        });
      }
    },
  );

  router.get(
    '/ec2/resources',
    requireTenantRole(deps.membershipRepository, ...EC2_READ_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);
      const tenantId = resolveRouteTenantContext(req).tenantId;
      try {
        const query = parseEc2ResourceListQuery(req.query, tenantId, { requireAccountId: true });
        const page = await deps.ec2DiscoveryApi.listResources(query);

        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: AUDIT_EVENTS.EC2_RESOURCE_LISTED,
            outcome: 'success',
            requestId,
            correlationId,
            actor,
            tenantId,
            action: 'ec2.resource_list',
            method: req.method,
            path: req.path,
            statusCode: 200,
            resource: { type: 'aws_account', id: query.accountId, accountId: query.accountId },
          }),
        );

        res.json(
          buildSuccessResponse(
            { items: page.items, nextToken: page.nextToken },
            requestId,
          ),
        );
      } catch (error) {
        const queryAccountId =
          typeof req.query.accountId === 'string' ? req.query.accountId : undefined;
        handleEc2RouteError(res, error, requestId, {
          requestId,
          correlationId,
          tenantId,
          accountId: queryAccountId,
          operation: 'ec2.resource_list',
          method: req.method,
          path: req.path,
        });
      }
    },
  );

  return router;
}
