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
import { isPlatformAdministrator } from './tenant-admin-authorization';
import { getRequestSecurityContext } from './request-security-context';
import { sisumRoleSatisfiesTenantRole, TENANT_ROLES, type TenantRole } from './tenant-roles';
import type { SisumRole } from './roles';

const EXECUTION_PRIVILEGED_TENANT_ROLES = [
  TENANT_ROLES.TENANT_OWNER,
  TENANT_ROLES.SECURITY_ADMIN,
] as const;

export function canPerformExecutionPrivilegedAction(
  membershipRole: TenantRole | undefined,
  identityGroups: readonly SisumRole[],
  isPlatformAdmin: boolean,
): boolean {
  if (isPlatformAdmin) {
    return true;
  }

  if (!membershipRole) {
    return false;
  }

  return EXECUTION_PRIVILEGED_TENANT_ROLES.some(
    (role) =>
      membershipRole === role &&
      sisumRoleSatisfiesTenantRole(identityGroups, role),
  );
}

export function requireExecutionPrivilegedRole(
  membershipRepository: MembershipRepository,
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
              'execution-api',
            ),
          );
        return;
      }

      if (isPlatformAdministrator(context)) {
        next();
        return;
      }

      const membership = await membershipRepository.get(
        context.tenantId,
        identity.userId,
      );

      const allowed = canPerformExecutionPrivilegedAction(
        membership?.status === 'ACTIVE' ? membership.role : undefined,
        identity.groups,
        false,
      );

      if (!allowed) {
        const event = writeAuditEvent({
          eventName: AUDIT_EVENTS.AUTHORIZATION_DENIED,
          outcome: 'denied',
          requestId: context.requestId,
          correlationId: context.correlationId,
          actor,
          tenantId: context.tenantId,
          action: 'authorize.execution_privileged',
          method: req.method,
          path: req.path,
          statusCode: 403,
          reason: 'Execution privileged role required.',
          errorCode: 'FORBIDDEN',
        });
        scheduleAuditPersistence(req, event);

        res
          .status(403)
          .json(
            buildErrorResponse(
              'FORBIDDEN',
              'You are not authorized to perform this execution operation.',
              context.requestId,
              'execution-api',
            ),
          );
        return;
      }

      next();
    })();
  };
}
