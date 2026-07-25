/**
 * Express middleware enforcing per-tenant membership roles.
 *
 * Complements requireAnyRole() (Cognito group gate) with a finer-grained
 * check against the caller's own TenantMembership record for the resolved
 * tenant. Both gates must pass — this middleware never widens access
 * beyond what the identity's Cognito groups already permit
 * (see sisumRoleSatisfiesTenantRole in ./tenant-roles).
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import {
  AUDIT_EVENTS,
  getAuditActor,
  scheduleAuditPersistence,
  writeAuditEvent,
} from '../audit';
import type { MembershipRepository } from '../repositories/contracts';
import { buildErrorResponse } from '../shared/utils';
import { getAuthenticatedIdentity } from './identity';
import { getRequestSecurityContext } from './request-security-context';
import { sisumRoleSatisfiesTenantRole, type TenantRole } from './tenant-roles';

export function requireTenantRole(
  membershipRepository: MembershipRepository,
  ...allowedRoles: readonly TenantRole[]
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      const identity = getAuthenticatedIdentity(req);
      const context = getRequestSecurityContext(req);
      const actor = getAuditActor(req);

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

      const membership = await membershipRepository.get(
        context.tenantId,
        identity.userId,
      );

      const roleAllowed = Boolean(
        membership &&
          membership.status === 'ACTIVE' &&
          allowedRoles.includes(membership.role) &&
          sisumRoleSatisfiesTenantRole(identity.groups, membership.role),
      );

      if (!roleAllowed) {
        const event = writeAuditEvent({
          eventName: AUDIT_EVENTS.AUTHORIZATION_DENIED,
          outcome: 'denied',
          requestId: context.requestId,
          correlationId: context.correlationId,
          actor,
          tenantId: context.tenantId,
          action: 'authorize.tenant_role',
          method: req.method,
          path: req.path,
          statusCode: 403,
          reason: `Required tenant role: ${allowedRoles.join(', ')}`,
          errorCode: 'FORBIDDEN',
        });

        scheduleAuditPersistence(req, event);

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
        return;
      }

      next();
    })().catch(next);
  };
}
