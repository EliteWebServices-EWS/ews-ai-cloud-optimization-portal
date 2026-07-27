import { Router, type Request, type Response } from 'express';

import {
  AUDIT_EVENTS,
  getAuditActor,
  getCorrelationId,
  getRequestId,
  scheduleAuditPersistence,
  writeAuditEvent,
} from '../../audit';
import {
  ADMIN_ROLES,
  MEMBERSHIP_MANAGEMENT_ROLES,
  getRequestSecurityContext,
  requireAnyRole,
  requireTenantRole,
} from '../../auth';
import type { MembershipService } from '../../membership';
import type { MembershipRepository } from '../../repositories/contracts';
import {
  AppError,
  buildErrorResponse,
  buildSuccessResponse,
  isAppError,
} from '../../shared/utils';
import { handleTenantScopedResourceMiss } from '../tenant-route-helpers';

export interface MembershipRouteDeps {
  membershipService: MembershipService;
  membershipRepository: MembershipRepository;
}

function handleRouteError(
  res: Response,
  error: unknown,
  requestId: string,
  stage: string,
): void {
  if (isAppError(error)) {
    res
      .status(error.statusCode)
      .json(buildErrorResponse(error.code, error.message, requestId, error.stage ?? stage));
    return;
  }

  const message = error instanceof Error ? error.message : 'Request failed';
  res.status(500).json(buildErrorResponse('MEMBERSHIP_ERROR', message, requestId, stage));
}

function requireBodyString(
  body: unknown,
  field: string,
  maxLength = 320,
): string {
  const value = (body as Record<string, unknown> | undefined)?.[field];

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError('INVALID_REQUEST', `${field} is required and must be a non-empty string.`, 400);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new AppError('INVALID_REQUEST', `${field} exceeds the maximum allowed length.`, 400);
  }

  return trimmed;
}

function optionalBodyString(body: unknown, field: string): string | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError('INVALID_REQUEST', `${field} must be a non-empty string when provided.`, 400);
  }
  return value.trim();
}

function optionalBodyVersion(body: unknown): number | undefined {
  const value = (body as Record<string, unknown> | undefined)?.expectedVersion;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new AppError('INVALID_REQUEST', 'expectedVersion must be a positive integer.', 400);
  }
  return value;
}

/**
 * Validates that the {tenantId} path segment matches the trusted tenant
 * resolved from the caller's access-token claim. tenantId is NEVER trusted
 * from a route parameter (see auth/tenant.ts) — the path segment exists
 * only to satisfy the requested URL shape and is checked, not authoritative.
 * A mismatch is reported as 404 to avoid confirming cross-tenant existence.
 */
function assertPathTenantMatchesTrustedTenant(req: Request): string {
  const trustedTenantId = getRequestSecurityContext(req).tenantId;
  const pathTenantId = req.params.tenantId;

  if (pathTenantId && pathTenantId !== trustedTenantId) {
    handleTenantScopedResourceMiss(req, {
      resourceType: 'tenant',
      resourceId: pathTenantId,
      ownerTenantId: pathTenantId,
      label: 'Tenant',
    });
  }

  return trustedTenantId;
}

/** Tenant membership + invitation routes (Tasks 1-5). */
export function createMembershipRoutes(deps: MembershipRouteDeps): Router {
  const router = Router();
  const { membershipService, membershipRepository } = deps;

  const requireMembershipManager = requireTenantRole(
    membershipRepository,
    ...MEMBERSHIP_MANAGEMENT_ROLES,
  );

  // POST /tenants/{tenantId}/members — Task 5: direct member add (Task 1 persistence).
  router.post(
    '/tenants/:tenantId/members',
    requireAnyRole(...ADMIN_ROLES),
    requireMembershipManager,
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);

      try {
        const tenantId = assertPathTenantMatchesTrustedTenant(req);
        const userId = requireBodyString(req.body, 'userId');
        const role = requireBodyString(req.body, 'role');

        const member = await membershipService.addMember({
          tenantId,
          userId,
          role: role as never,
          addedBy: actor.userId ?? 'unknown',
        });

        const event = writeAuditEvent({
          eventName: AUDIT_EVENTS.MEMBER_ADDED,
          outcome: 'success',
          requestId,
          correlationId,
          actor,
          tenantId,
          action: 'member.add',
          method: req.method,
          path: req.path,
          statusCode: 201,
        });
        scheduleAuditPersistence(req, event);

        res.status(201).json(buildSuccessResponse({ member }, requestId));
      } catch (error) {
        const event = writeAuditEvent({
          eventName: AUDIT_EVENTS.MEMBER_ACTION_FAILED,
          outcome: 'failure',
          requestId,
          correlationId,
          actor,
          action: 'member.add',
          method: req.method,
          path: req.path,
          statusCode: isAppError(error) ? error.statusCode : 500,
          reason: error instanceof Error ? error.message : 'Member add failed.',
          errorCode: isAppError(error) ? error.code : 'MEMBERSHIP_ERROR',
        });
        scheduleAuditPersistence(req, event);

        handleRouteError(res, error, requestId, 'membership');
      }
    },
  );

  // GET /tenants/{tenantId}/members — list, for operational visibility.
  router.get('/tenants/:tenantId/members', async (req: Request, res: Response) => {
    const requestId = getRequestId(req);

    try {
      const tenantId = assertPathTenantMatchesTrustedTenant(req);
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      const nextToken = typeof req.query.nextToken === 'string' ? req.query.nextToken : undefined;

      const page = await membershipService.listMembers(tenantId, limit, nextToken);

      res.json(
        buildSuccessResponse(
          { members: page.items, pagination: { nextToken: page.nextToken } },
          requestId,
        ),
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'membership');
    }
  });

  // POST /tenants/{tenantId}/invite — Task 2 + Task 4 "Invite".
  router.post(
    '/tenants/:tenantId/invite',
    requireAnyRole(...ADMIN_ROLES),
    requireMembershipManager,
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const correlationId = getCorrelationId(req, requestId);
      const actor = getAuditActor(req);

      try {
        const tenantId = assertPathTenantMatchesTrustedTenant(req);
        const email = requireBodyString(req.body, 'email');
        const role = requireBodyString(req.body, 'role');

        const { invitation, token } = await membershipService.inviteMember({
          tenantId,
          email,
          role: role as never,
          invitedBy: actor.userId ?? 'unknown',
        });

        const event = writeAuditEvent({
          eventName: AUDIT_EVENTS.INVITATION_CREATED,
          outcome: 'success',
          requestId,
          correlationId,
          actor,
          tenantId,
          action: 'invitation.create',
          method: req.method,
          path: req.path,
          statusCode: 201,
        });
        scheduleAuditPersistence(req, event);

        // The raw token is returned exactly once and is not retrievable again.
        res.status(201).json(
          buildSuccessResponse(
            {
              invitation: {
                invitationId: invitation.invitationId,
                tenantId: invitation.tenantId,
                email: invitation.email,
                role: invitation.role,
                status: invitation.status,
                expiresAt: invitation.expiresAtIso,
                createdAt: invitation.createdAt,
              },
              token,
            },
            requestId,
          ),
        );
      } catch (error) {
        const event = writeAuditEvent({
          eventName: AUDIT_EVENTS.INVITATION_ACTION_FAILED,
          outcome: 'failure',
          requestId,
          correlationId,
          actor,
          action: 'invitation.create',
          method: req.method,
          path: req.path,
          statusCode: isAppError(error) ? error.statusCode : 500,
          reason: error instanceof Error ? error.message : 'Invitation creation failed.',
          errorCode: isAppError(error) ? error.code : 'MEMBERSHIP_ERROR',
        });
        scheduleAuditPersistence(req, event);

        handleRouteError(res, error, requestId, 'membership');
      }
    },
  );

  // GET /tenants/{tenantId}/invitations — list, for operational visibility.
  router.get('/tenants/:tenantId/invitations', async (req: Request, res: Response) => {
    const requestId = getRequestId(req);

    try {
      const tenantId = assertPathTenantMatchesTrustedTenant(req);
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      const nextToken = typeof req.query.nextToken === 'string' ? req.query.nextToken : undefined;

      const page = await membershipService.listInvitations(tenantId, limit, nextToken);

      res.json(
        buildSuccessResponse(
          {
            invitations: page.items.map((invitation) => ({
              invitationId: invitation.invitationId,
              email: invitation.email,
              role: invitation.role,
              status: membershipService.resolveInvitationStatus(invitation),
              expiresAt: invitation.expiresAtIso,
              createdAt: invitation.createdAt,
              acceptedAt: invitation.acceptedAt,
              cancelledAt: invitation.cancelledAt,
            })),
            pagination: { nextToken: page.nextToken },
          },
          requestId,
        ),
      );
    } catch (error) {
      handleRouteError(res, error, requestId, 'membership');
    }
  });

  // POST /tenants/{tenantId}/invitations/{invitationId}/cancel — Task 2 "Cancelled" status.
  router.post(
    '/tenants/:tenantId/invitations/:invitationId/cancel',
    requireAnyRole(...ADMIN_ROLES),
    requireMembershipManager,
    async (req: Request, res: Response) => {
      const requestId = getRequestId(req);
      const actor = getAuditActor(req);

      try {
        const tenantId = assertPathTenantMatchesTrustedTenant(req);
        const invitation = await membershipService.cancelInvitation(
          tenantId,
          req.params.invitationId,
          actor.userId ?? 'unknown',
        );

        res.json(buildSuccessResponse({ invitation }, requestId));
      } catch (error) {
        handleRouteError(res, error, requestId, 'membership');
      }
    },
  );

  // POST /invitations/accept — Task 4 "Accept" lifecycle action.
  // Deliberately NOT nested under /tenants/{tenantId} — the invitation
  // token itself (never a client-supplied tenantId) determines the tenant.
  router.post('/invitations/accept', async (req: Request, res: Response) => {
    const requestId = getRequestId(req);
    const correlationId = getCorrelationId(req, requestId);
    const actor = getAuditActor(req);

    try {
      if (!actor.userId) {
        throw new AppError('AUTHENTICATION_REQUIRED', 'Authentication is required to accept an invitation.', 401);
      }

      const token = requireBodyString(req.body, 'token', 4096);

      const member = await membershipService.acceptInvitation({
        token,
        acceptingUserId: actor.userId,
      });

      const event = writeAuditEvent({
        eventName: AUDIT_EVENTS.INVITATION_ACCEPTED,
        outcome: 'success',
        requestId,
        correlationId,
        actor,
        tenantId: member.tenantId,
        action: 'invitation.accept',
        method: req.method,
        path: req.path,
        statusCode: 200,
      });
      scheduleAuditPersistence(req, event);

      res.json(buildSuccessResponse({ member }, requestId));
    } catch (error) {
      const event = writeAuditEvent({
        eventName: AUDIT_EVENTS.INVITATION_ACTION_FAILED,
        outcome: 'failure',
        requestId,
        correlationId,
        actor,
        action: 'invitation.accept',
        method: req.method,
        path: req.path,
        statusCode: isAppError(error) ? error.statusCode : 500,
        reason: error instanceof Error ? error.message : 'Invitation acceptance failed.',
        errorCode: isAppError(error) ? error.code : 'MEMBERSHIP_ERROR',
      });
      scheduleAuditPersistence(req, event);

      handleRouteError(res, error, requestId, 'membership');
    }
  });

  // PATCH /members/{memberId} — Task 3 role assignment + Task 4 Suspend/Reactivate.
  router.patch('/members/:memberId', async (req: Request, res: Response) => {
    const requestId = getRequestId(req);
    const correlationId = getCorrelationId(req, requestId);
    const actor = getAuditActor(req);
    const trustedTenantId = getRequestSecurityContext(req).tenantId;

    try {
      const memberId = requireBodyStringParam(req.params.memberId, 'memberId');
      const current = await membershipService.getMemberById(memberId);

      if (current.tenantId !== trustedTenantId) {
        handleTenantScopedResourceMiss(req, {
          resourceType: 'member',
          resourceId: memberId,
          ownerTenantId: current.tenantId,
          label: 'Member',
        });
      }

      await requireMembershipManagerFor(req, res, membershipRepository, trustedTenantId);
      if (res.headersSent) {
        return;
      }

      const role = optionalBodyString(req.body, 'role');
      const status = optionalBodyString(req.body, 'status');
      const expectedVersion = optionalBodyVersion(req.body);

      if (status !== undefined && status !== 'ACTIVE' && status !== 'SUSPENDED') {
        throw new AppError(
          'INVALID_REQUEST',
          "status must be 'ACTIVE' or 'SUSPENDED' (use DELETE /members/{memberId} to remove a member).",
          400,
        );
      }

      const member = await membershipService.updateMember({
        memberId,
        role: role as never,
        status: status as never,
        actorUserId: actor.userId ?? undefined,
        expectedVersion,
      });

      const eventName =
        status === 'SUSPENDED'
          ? AUDIT_EVENTS.MEMBER_SUSPENDED
          : status === 'ACTIVE'
            ? AUDIT_EVENTS.MEMBER_REACTIVATED
            : AUDIT_EVENTS.MEMBER_UPDATED;

      const event = writeAuditEvent({
        eventName,
        outcome: 'success',
        requestId,
        correlationId,
        actor,
        tenantId: member.tenantId,
        action: 'member.update',
        method: req.method,
        path: req.path,
        statusCode: 200,
      });
      scheduleAuditPersistence(req, event);

      res.json(buildSuccessResponse({ member }, requestId));
    } catch (error) {
      if (res.headersSent) {
        return;
      }

      const event = writeAuditEvent({
        eventName: AUDIT_EVENTS.MEMBER_ACTION_FAILED,
        outcome: 'failure',
        requestId,
        correlationId,
        actor,
        action: 'member.update',
        method: req.method,
        path: req.path,
        statusCode: isAppError(error) ? error.statusCode : 500,
        reason: error instanceof Error ? error.message : 'Member update failed.',
        errorCode: isAppError(error) ? error.code : 'MEMBERSHIP_ERROR',
      });
      scheduleAuditPersistence(req, event);

      handleRouteError(res, error, requestId, 'membership');
    }
  });

  // DELETE /members/{memberId} — Task 4 "Remove" lifecycle action.
  router.delete('/members/:memberId', async (req: Request, res: Response) => {
    const requestId = getRequestId(req);
    const correlationId = getCorrelationId(req, requestId);
    const actor = getAuditActor(req);
    const trustedTenantId = getRequestSecurityContext(req).tenantId;

    try {
      const memberId = requireBodyStringParam(req.params.memberId, 'memberId');
      const current = await membershipService.getMemberById(memberId);

      if (current.tenantId !== trustedTenantId) {
        handleTenantScopedResourceMiss(req, {
          resourceType: 'member',
          resourceId: memberId,
          ownerTenantId: current.tenantId,
          label: 'Member',
        });
      }

      await requireMembershipManagerFor(req, res, membershipRepository, trustedTenantId);
      if (res.headersSent) {
        return;
      }

      const expectedVersion =
        typeof req.query.expectedVersion === 'string'
          ? Number(req.query.expectedVersion)
          : undefined;

      const member = await membershipService.removeMember(
        memberId,
        actor.userId ?? undefined,
        expectedVersion,
      );

      const event = writeAuditEvent({
        eventName: AUDIT_EVENTS.MEMBER_REMOVED,
        outcome: 'success',
        requestId,
        correlationId,
        actor,
        tenantId: member.tenantId,
        action: 'member.remove',
        method: req.method,
        path: req.path,
        statusCode: 200,
      });
      scheduleAuditPersistence(req, event);

      res.json(buildSuccessResponse({ member }, requestId));
    } catch (error) {
      if (res.headersSent) {
        return;
      }

      const event = writeAuditEvent({
        eventName: AUDIT_EVENTS.MEMBER_ACTION_FAILED,
        outcome: 'failure',
        requestId,
        correlationId,
        actor,
        action: 'member.remove',
        method: req.method,
        path: req.path,
        statusCode: isAppError(error) ? error.statusCode : 500,
        reason: error instanceof Error ? error.message : 'Member removal failed.',
        errorCode: isAppError(error) ? error.code : 'MEMBERSHIP_ERROR',
      });
      scheduleAuditPersistence(req, event);

      handleRouteError(res, error, requestId, 'membership');
    }
  });

  return router;
}

function requireBodyStringParam(value: string | undefined, field: string): string {
  if (!value || value.trim().length === 0) {
    throw new AppError('INVALID_REQUEST', `${field} is required.`, 400);
  }
  return value.trim();
}

/**
 * PATCH/DELETE /members/{memberId} don't carry a tenantId in the path, so
 * the tenant-role check runs after the member record (and thus its
 * tenantId) has been resolved, rather than via the requireTenantRole
 * middleware factory used on the /tenants/{tenantId}/* routes above.
 */
async function requireMembershipManagerFor(
  req: Request,
  res: Response,
  membershipRepository: MembershipRepository,
  tenantId: string,
): Promise<void> {
  const identity = getAuditActor(req);
  const context = getRequestSecurityContext(req);

  if (!identity.userId) {
    res
      .status(401)
      .json(
        buildErrorResponse(
          'AUTHENTICATION_REQUIRED',
          'Authentication is required to access this resource.',
          context.requestId,
          'authorization',
        ),
      );
    return;
  }

  const requesterMembership = await membershipRepository.get(
    tenantId,
    identity.userId,
  );

  const authorized = Boolean(
    requesterMembership &&
      requesterMembership.status === 'ACTIVE' &&
      MEMBERSHIP_MANAGEMENT_ROLES.includes(requesterMembership.role),
  );

  if (!authorized) {
    res
      .status(403)
      .json(
        buildErrorResponse(
          'FORBIDDEN',
          'You do not have permission to manage membership for this tenant.',
          context.requestId,
          'authorization',
        ),
      );
  }
}
