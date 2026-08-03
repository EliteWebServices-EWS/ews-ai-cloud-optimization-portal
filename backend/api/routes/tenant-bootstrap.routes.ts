/**
 * One-time tenant owner bootstrap — no durable membership required to call.
 */

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
  ADMIN_ROLES,
  getAuthenticatedIdentity,
  isPlatformAdministrator,
  PRIVILEGED_OPERATIONS,
  requireAnyRole,
  requirePrivilegedMfa,
} from '../../auth';
import type { MembershipService } from '../../membership';
import type { TenantRepository } from '../../repositories/contracts';
import {
  assertTenantEligibleForOwnerBootstrap,
  TENANT_OWNER_BOOTSTRAP_DENIED_CODES,
} from '../../services/tenant-owner-bootstrap';
import {
  AppError,
  buildErrorResponse,
  buildSuccessResponse,
  isAppError,
} from '../../shared/utils';
import { resolveRouteTenantContext } from '../tenant-route-helpers';

const BOOTSTRAP_BODY_FORBIDDEN_FIELDS = [
  'tenantId',
  'userId',
  'role',
  'memberId',
  'addedBy',
] as const;

export interface TenantBootstrapRouteDeps {
  membershipService: MembershipService;
  tenantRepository: TenantRepository;
}

function assertEmptyBootstrapBody(body: unknown): void {
  if (body === undefined || body === null) {
    return;
  }

  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(
      'INVALID_REQUEST',
      'Request body must be a JSON object or empty.',
      400,
    );
  }

  for (const field of BOOTSTRAP_BODY_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      throw new AppError(
        'INVALID_REQUEST',
        `${field} must not be supplied; bootstrap derives tenant and user from trusted identity.`,
        400,
      );
    }
  }
}

function auditBootstrapEvent(
  req: Request,
  input: {
    eventName: AuditEventName;
    outcome: 'started' | 'success' | 'failure' | 'denied';
    statusCode: number;
    tenantId?: string;
    memberId?: string;
    errorCode?: string;
    reason?: string;
  },
): void {
  const requestId = getRequestId(req);
  const correlationId = getCorrelationId(req, requestId);
  const actor = getAuditActor(req);

  const event = writeAuditEvent({
    eventName: input.eventName,
    outcome: input.outcome,
    requestId,
    correlationId,
    actor,
    tenantId: input.tenantId,
    action: 'tenant.owner_bootstrap',
    method: req.method,
    path: req.path,
    statusCode: input.statusCode,
    resource: input.memberId
      ? { type: 'membership', id: input.memberId }
      : undefined,
    errorCode: input.errorCode,
    reason: input.reason,
  });

  scheduleAuditPersistence(req, event);
}

function sanitizeMembershipResponse(
  record: import('../../repositories/models').MembershipRecord,
): Record<string, unknown> {
  return {
    tenantId: record.tenantId,
    memberId: record.memberId,
    userId: record.userId,
    role: record.role,
    status: record.status,
    joinedAt: record.joinedAt,
    statusChangedAt: record.statusChangedAt,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createTenantBootstrapRoutes(
  deps: TenantBootstrapRouteDeps,
): Router {
  const router = Router();

  router.post(
    '/tenants/bootstrap-owner',
    requireAnyRole(...ADMIN_ROLES),
    requirePrivilegedMfa(PRIVILEGED_OPERATIONS.TENANT_OWNER_BOOTSTRAP),
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const identity = getAuthenticatedIdentity(req);
      const context = resolveRouteTenantContext(req);
      const tenantId = context.tenantId;

      auditBootstrapEvent(req, {
        eventName: AUDIT_EVENTS.TENANT_OWNER_BOOTSTRAP_STARTED,
        outcome: 'started',
        statusCode: 201,
        tenantId,
      });

      if (!identity.userId) {
        auditBootstrapEvent(req, {
          eventName: AUDIT_EVENTS.TENANT_OWNER_BOOTSTRAP_DENIED,
          outcome: 'denied',
          statusCode: 403,
          tenantId,
          errorCode: 'FORBIDDEN',
          reason: 'Authenticated identity is missing a trusted user id.',
        });

        res.status(403).json(
          buildErrorResponse(
            'FORBIDDEN',
            'You do not have permission to bootstrap tenant ownership.',
            requestId,
            'tenant-bootstrap',
          ),
        );
        return;
      }

      if (!isPlatformAdministrator(context)) {
        auditBootstrapEvent(req, {
          eventName: AUDIT_EVENTS.TENANT_OWNER_BOOTSTRAP_DENIED,
          outcome: 'denied',
          statusCode: 403,
          tenantId,
          errorCode: 'FORBIDDEN',
          reason: 'Caller is not a platform administrator.',
        });

        res.status(403).json(
          buildErrorResponse(
            'FORBIDDEN',
            'You do not have permission to bootstrap tenant ownership.',
            requestId,
            'tenant-bootstrap',
          ),
        );
        return;
      }

      try {
        assertEmptyBootstrapBody(req.body);

        const tenant = await deps.tenantRepository.getById(tenantId);
        assertTenantEligibleForOwnerBootstrap(tenant);

        const member = await deps.membershipService.bootstrapFirstOwner({
          tenantId,
          userId: identity.userId,
        });

        auditBootstrapEvent(req, {
          eventName: AUDIT_EVENTS.TENANT_OWNER_BOOTSTRAP_SUCCEEDED,
          outcome: 'success',
          statusCode: 201,
          tenantId,
          memberId: member.memberId,
        });

        res.status(201).json(
          buildSuccessResponse(
            { member: sanitizeMembershipResponse(member) },
            requestId,
          ),
        );
      } catch (error) {
        const statusCode = isAppError(error) ? error.statusCode : 500;
        const errorCode = isAppError(error) ? error.code : 'ENGINE_ERROR';
        const denied =
          isAppError(error) &&
          TENANT_OWNER_BOOTSTRAP_DENIED_CODES.has(error.code);

        auditBootstrapEvent(req, {
          eventName: denied
            ? AUDIT_EVENTS.TENANT_OWNER_BOOTSTRAP_DENIED
            : AUDIT_EVENTS.TENANT_OWNER_BOOTSTRAP_FAILED,
          outcome: denied ? 'denied' : 'failure',
          statusCode,
          tenantId,
          errorCode,
          reason: error instanceof Error ? error.message : 'Bootstrap failed.',
        });

        if (isAppError(error)) {
          res
            .status(error.statusCode)
            .json(
              buildErrorResponse(
                error.code,
                error.message,
                requestId,
                error.stage ?? 'tenant-bootstrap',
              ),
            );
          return;
        }

        res.status(500).json(
          buildErrorResponse(
            'ENGINE_ERROR',
            'Tenant owner bootstrap failed.',
            requestId,
            'tenant-bootstrap',
          ),
        );
      }
    },
  );

  return router;
}
