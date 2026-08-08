/**
 * Tenant Administration API.
 *
 * Administers the tenant registry itself (create, update, suspend,
 * reactivate, archive, delete, and platform-wide search) — distinct from
 * the tenant-scoped business-data routes (workflows/reports/etc.) elsewhere
 * in this file, which operate *within* a tenant boundary rather than on the
 * registry of tenants.
 *
 * Authorization (see ../../auth/tenant-admin-authorization.ts):
 *   - Create Tenant and List Tenants are Platform Admin only — there is no
 *     tenant to scope against yet (create) or the operation is inherently
 *     platform-wide (list).
 *   - Get/Update/Suspend/Reactivate/Archive/Delete are open to any
 *     authenticated SISUM user, then scoped per-request to Platform Admin,
 *     Tenant Owner, or Tenant Admin for that specific tenant. A caller who
 *     fails that check receives the same safe 404 a genuinely missing
 *     tenant would produce — this endpoint never reveals that a tenant
 *     exists to a caller who isn't allowed to administer it.
 *
 * Every mutation emits a structured audit event (Task 4). Reads do not,
 * matching the existing convention (e.g. GET /reports is not audited;
 * POST /reports/generate is).
 */

import { Router, type Request, type Response } from 'express';
import {
  AUDIT_EVENTS,
  getAuditActor,
  getRequestId,
  scheduleAuditPersistence,
  writeAuditEvent,
} from '../../audit';
import {
  ADMIN_ROLES,
  ALL_AUTHENTICATED_ROLES,
  canAdministerTenant,
  getRequestSecurityContext,
  PRIVILEGED_OPERATIONS,
  requireAnyRole,
  requirePrivilegedMfa,
} from '../../auth';
import {
  RepositoryAlreadyExistsError,
  RepositoryConflictError,
  RepositoryNotFoundError,
} from '../../database';
import type { TenantRepository } from '../../repositories/contracts';
import type { TenantRecord, TenantStatus } from '../../repositories/models';
import type { TenantOnboardingService } from '../../services/tenant-onboarding.service';
import {
  InvalidTenantTransitionError,
} from '../../services/tenant-lifecycle';
import {
  applyTenantQuery,
  fetchAllTenants,
  parseTenantQuery,
  TenantQueryValidationError,
} from '../../services/tenant-query';
import {
  AppError,
  buildErrorResponse,
  buildSuccessResponse,
  isAppError,
} from '../../shared/utils';
import {
  validateCreateTenantBody,
  validateExpectedVersion,
  validateUpdateTenantBody,
} from '../tenant-admin-validation';

function handleTenantAdminRouteError(
  res: Response,
  error: unknown,
  requestId: string
): void {
  if (error instanceof RepositoryConflictError) {
    res
      .status(409)
      .json(
        buildErrorResponse('CONFLICT', error.message, requestId, 'tenant-admin')
      );
    return;
  }

  if (error instanceof InvalidTenantTransitionError) {
    res
      .status(409)
      .json(
        buildErrorResponse('CONFLICT', error.message, requestId, 'tenant-admin')
      );
    return;
  }

  if (error instanceof RepositoryAlreadyExistsError) {
    res
      .status(409)
      .json(
        buildErrorResponse('CONFLICT', error.message, requestId, 'tenant-admin')
      );
    return;
  }

  if (error instanceof RepositoryNotFoundError) {
    res
      .status(404)
      .json(
        buildErrorResponse(
          'NOT_FOUND',
          'Tenant not found.',
          requestId,
          'tenant-admin'
        )
      );
    return;
  }

  if (isAppError(error)) {
    res
      .status(error.statusCode)
      .json(
        buildErrorResponse(error.code, error.message, requestId, 'tenant-admin')
      );
    return;
  }

  const message = error instanceof Error ? error.message : 'Request failed';
  res
    .status(500)
    .json(buildErrorResponse('ENGINE_ERROR', message, requestId, 'tenant-admin'));
}

/**
 * Load a tenant and verify the caller may administer it. Throws the same
 * safe 404 for a genuinely missing tenant and for one the caller is not
 * authorized to administer — never revealing which case applies. Only the
 * latter case (tenant exists, caller unauthorized) emits an audit event,
 * matching the existing tenant.access_denied convention.
 */
async function loadAdministerableTenant(
  req: Request,
  tenantRepository: TenantRepository,
  tenantId: string
): Promise<TenantRecord> {
  const tenant = await tenantRepository.getById(tenantId);

  if (!tenant) {
    throw new AppError('NOT_FOUND', 'Tenant not found.', 404, 'tenant-admin');
  }

  const context = getRequestSecurityContext(req);

  if (!canAdministerTenant(context, tenant)) {
    const actor = getAuditActor(req);
    const event = writeAuditEvent({
      eventName: AUDIT_EVENTS.TENANT_ADMINISTRATION_DENIED,
      outcome: 'denied',
      requestId: context.requestId,
      correlationId: context.correlationId,
      actor,
      tenantId: context.tenantId,
      resourceTenantId: tenant.tenantId,
      action: 'tenant.administer',
      method: req.method,
      path: req.path,
      statusCode: 404,
      resource: { type: 'tenant', id: tenantId },
      reason:
        'Caller is not the Platform Admin, Tenant Owner, or Tenant Admin for this tenant.',
      errorCode: 'NOT_FOUND',
    });
    scheduleAuditPersistence(req, event);

    throw new AppError('NOT_FOUND', 'Tenant not found.', 404, 'tenant-admin');
  }

  return tenant;
}

function recordTenantAuditEvent(
  req: Request,
  input: {
    eventName: (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];
    tenantId: string;
    action: string;
    reason?: string;
  }
): void {
  const context = getRequestSecurityContext(req);
  const actor = getAuditActor(req);

  const event = writeAuditEvent({
    eventName: input.eventName,
    outcome: 'success',
    requestId: context.requestId,
    correlationId: context.correlationId,
    actor,
    tenantId: context.tenantId,
    action: input.action,
    method: req.method,
    path: req.path,
    statusCode: 200,
    resource: { type: 'tenant', id: input.tenantId },
    reason: input.reason,
  });

  scheduleAuditPersistence(req, event);
}

async function transitionTenant(
  req: Request,
  res: Response,
  tenantRepository: TenantRepository,
  nextStatus: TenantStatus,
  eventName: (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS],
  action: string
): Promise<void> {
  const requestId = getRequestId(req);

  try {
    const tenantId = req.params.tenantId;
    await loadAdministerableTenant(req, tenantRepository, tenantId);

    const expectedVersion = validateExpectedVersion(
      (req.body as Record<string, unknown> | undefined)?.version
    );

    const updated = await tenantRepository.transitionStatus(
      tenantId,
      nextStatus,
      { expectedVersion }
    );

    recordTenantAuditEvent(req, {
      eventName,
      tenantId,
      action,
    });

    res.json(buildSuccessResponse(updated, requestId));
  } catch (error) {
    handleTenantAdminRouteError(res, error, requestId);
  }
}

export function createTenantAdminRoutes(deps: {
  tenantRepository: TenantRepository;
  tenantOnboardingService: TenantOnboardingService;
}): Router {
  const { tenantRepository, tenantOnboardingService } = deps;
  const router = Router();

  router.post(
    '/admin/tenants',
    requireAnyRole(...ADMIN_ROLES),
    requirePrivilegedMfa(PRIVILEGED_OPERATIONS.TENANT_CREATE),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const context = getRequestSecurityContext(req);
      const actor = getAuditActor(req);

      const startedEvent = writeAuditEvent({
        eventName: AUDIT_EVENTS.TENANT_ONBOARDING_STARTED,
        outcome: 'started',
        requestId: context.requestId,
        correlationId: context.correlationId,
        actor,
        tenantId: context.tenantId,
        action: 'tenant.onboarding',
        method: req.method,
        path: req.path,
        statusCode: 201,
      });
      scheduleAuditPersistence(req, startedEvent);

      try {
        const input = validateCreateTenantBody(req.body);

        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: AUDIT_EVENTS.TENANT_IDENTITY_ASSIGNMENT_STARTED,
            outcome: 'started',
            requestId: context.requestId,
            correlationId: context.correlationId,
            actor,
            tenantId: context.tenantId,
            action: 'tenant.identity_assignment',
            method: req.method,
            path: req.path,
            statusCode: 201,
            reason: `Assigning Cognito custom:tenantId for owner ${input.ownerUserId}.`,
          }),
        );

        const result = await tenantOnboardingService.onboardNewTenant(input);

        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: AUDIT_EVENTS.TENANT_IDENTITY_ASSIGNMENT_SUCCEEDED,
            outcome: 'success',
            requestId: context.requestId,
            correlationId: context.correlationId,
            actor,
            tenantId: result.tenant.tenantId,
            action: 'tenant.identity_assignment',
            method: req.method,
            path: req.path,
            statusCode: 201,
            resource: { type: 'tenant', id: result.tenant.tenantId },
            reason: 'PROVISIONING to ACTIVE after Cognito alignment.',
          }),
        );

        recordTenantAuditEvent(req, {
          eventName: AUDIT_EVENTS.TENANT_CREATED,
          tenantId: result.tenant.tenantId,
          action: 'tenant.create',
        });

        recordTenantAuditEvent(req, {
          eventName: AUDIT_EVENTS.TENANT_ONBOARDING_COMPLETED,
          tenantId: result.tenant.tenantId,
          action: 'tenant.onboarding',
          reason:
            'Owner must sign out and sign in again to receive tenant_id on access token.',
        });

        res.status(201).json(
          buildSuccessResponse(
            {
              tenant: result.tenant,
              reauthenticationRequired: result.reauthenticationRequired,
            },
            requestId,
          ),
        );
      } catch (error) {
        if (isAppError(error) && error.code.startsWith('COGNITO_')) {
          scheduleAuditPersistence(
            req,
            writeAuditEvent({
              eventName: AUDIT_EVENTS.TENANT_IDENTITY_ASSIGNMENT_FAILED,
              outcome: 'failure',
              requestId: context.requestId,
              correlationId: context.correlationId,
              actor,
              tenantId: context.tenantId,
              action: 'tenant.identity_assignment',
              method: req.method,
              path: req.path,
              statusCode: error.statusCode,
              errorCode: error.code,
              reason: error.message,
            }),
          );
        }

        handleTenantAdminRouteError(res, error, requestId);
      }
    },
  );

  router.post(
    '/admin/tenants/:tenantId/complete-onboarding',
    requireAnyRole(...ADMIN_ROLES),
    requirePrivilegedMfa(PRIVILEGED_OPERATIONS.TENANT_ONBOARDING_COMPLETE),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const context = getRequestSecurityContext(req);
      const actor = getAuditActor(req);
      const tenantId = req.params.tenantId;

      scheduleAuditPersistence(
        req,
        writeAuditEvent({
          eventName: AUDIT_EVENTS.TENANT_ONBOARDING_RETRY_STARTED,
          outcome: 'started',
          requestId: context.requestId,
          correlationId: context.correlationId,
          actor,
          tenantId,
          action: 'tenant.onboarding_retry',
          method: req.method,
          path: req.path,
          statusCode: 200,
        }),
      );

      try {
        const result = await tenantOnboardingService.completeOnboarding(tenantId);

        scheduleAuditPersistence(
          req,
          writeAuditEvent({
            eventName: AUDIT_EVENTS.TENANT_ONBOARDING_RETRY_COMPLETED,
            outcome: 'success',
            requestId: context.requestId,
            correlationId: context.correlationId,
            actor,
            tenantId: result.tenant.tenantId,
            action: 'tenant.onboarding_retry',
            method: req.method,
            path: req.path,
            statusCode: 200,
            resource: { type: 'tenant', id: result.tenant.tenantId },
            reason: result.reauthenticationRequired
              ? 'Cognito alignment completed; owner must reauthenticate.'
              : 'Tenant already ACTIVE; idempotent success.',
          }),
        );

        res.json(
          buildSuccessResponse(
            {
              tenant: result.tenant,
              reauthenticationRequired: result.reauthenticationRequired,
            },
            requestId,
          ),
        );
      } catch (error) {
        if (isAppError(error) && error.code.startsWith('COGNITO_')) {
          scheduleAuditPersistence(
            req,
            writeAuditEvent({
              eventName: AUDIT_EVENTS.TENANT_IDENTITY_ASSIGNMENT_FAILED,
              outcome: 'failure',
              requestId: context.requestId,
              correlationId: context.correlationId,
              actor,
              tenantId,
              action: 'tenant.identity_assignment',
              method: req.method,
              path: req.path,
              statusCode: error.statusCode,
              errorCode: error.code,
              reason: error.message,
            }),
          );
        }

        handleTenantAdminRouteError(res, error, requestId);
      }
    },
  );

  router.get(
    '/admin/tenants',
    requireAnyRole(...ADMIN_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);

      try {
        const query = parseTenantQuery(req.query as Record<string, unknown>);
        const allTenants = await fetchAllTenants((page) =>
          tenantRepository.listAll(page)
        );
        const result = applyTenantQuery(allTenants, query);

        res.json(
          buildSuccessResponse(
            {
              tenants: result.tenants,
              total: result.total,
              filters: query.filters,
              search: query.search,
              sort: { sortBy: query.sortBy, sortOrder: query.sortOrder },
              pagination: {
                limit: query.limit,
                count: result.tenants.length,
                nextToken: result.nextToken,
              },
            },
            requestId
          )
        );
      } catch (error) {
        if (error instanceof TenantQueryValidationError) {
          handleTenantAdminRouteError(
            res,
            new AppError('INVALID_REQUEST', error.message, 400, 'tenant-admin'),
            requestId
          );
          return;
        }
        handleTenantAdminRouteError(res, error, requestId);
      }
    }
  );

  router.get(
    '/admin/tenants/:tenantId',
    requireAnyRole(...ALL_AUTHENTICATED_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);

      try {
        const tenant = await loadAdministerableTenant(
          req,
          tenantRepository,
          req.params.tenantId
        );

        res.json(buildSuccessResponse(tenant, requestId));
      } catch (error) {
        handleTenantAdminRouteError(res, error, requestId);
      }
    }
  );

  router.patch(
    '/admin/tenants/:tenantId',
    requireAnyRole(...ALL_AUTHENTICATED_ROLES),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);

      try {
        const tenantId = req.params.tenantId;
        await loadAdministerableTenant(req, tenantRepository, tenantId);

        const changes = validateUpdateTenantBody(req.body);
        const expectedVersion = validateExpectedVersion(
          (req.body as Record<string, unknown> | undefined)?.version
        );

        const updated = await tenantRepository.update(tenantId, changes, {
          expectedVersion,
        });

        recordTenantAuditEvent(req, {
          eventName: AUDIT_EVENTS.TENANT_UPDATED,
          tenantId,
          action: 'tenant.update',
          reason: `Updated fields: ${Object.keys(changes).join(', ')}`,
        });

        res.json(buildSuccessResponse(updated, requestId));
      } catch (error) {
        handleTenantAdminRouteError(res, error, requestId);
      }
    }
  );

  router.post(
    '/admin/tenants/:tenantId/suspend',
    requireAnyRole(...ALL_AUTHENTICATED_ROLES),
    requirePrivilegedMfa(PRIVILEGED_OPERATIONS.TENANT_SUSPEND),
    (req: Request, res: Response) =>
      transitionTenant(
        req,
        res,
        tenantRepository,
        'SUSPENDED',
        AUDIT_EVENTS.TENANT_SUSPENDED,
        'tenant.suspend'
      )
  );

  router.post(
    '/admin/tenants/:tenantId/reactivate',
    requireAnyRole(...ALL_AUTHENTICATED_ROLES),
    (req: Request, res: Response) =>
      transitionTenant(
        req,
        res,
        tenantRepository,
        'ACTIVE',
        AUDIT_EVENTS.TENANT_REACTIVATED,
        'tenant.reactivate'
      )
  );

  router.post(
    '/admin/tenants/:tenantId/archive',
    requireAnyRole(...ALL_AUTHENTICATED_ROLES),
    (req: Request, res: Response) =>
      transitionTenant(
        req,
        res,
        tenantRepository,
        'ARCHIVED',
        AUDIT_EVENTS.TENANT_ARCHIVED,
        'tenant.archive'
      )
  );

  router.delete(
    '/admin/tenants/:tenantId',
    requireAnyRole(...ALL_AUTHENTICATED_ROLES),
    requirePrivilegedMfa(PRIVILEGED_OPERATIONS.TENANT_DELETE),
    (req: Request, res: Response) =>
      transitionTenant(
        req,
        res,
        tenantRepository,
        'DELETED',
        AUDIT_EVENTS.TENANT_DELETED,
        'tenant.delete'
      )
  );

  return router;
}
