
/**
 * Express middleware for SISU'M role-based access control.
 */

import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express';
import {
  AUDIT_EVENTS,
  getAuditActor,
  getCorrelationId,
  getRequestId,
  writeAuditEvent,
} from '../audit';
import { buildErrorResponse } from '../shared/utils';
import { getAuthenticatedIdentity } from './identity';
import type { SisumRole } from './roles';

export function requireAnyRole(
  ...allowedRoles: readonly SisumRole[]
): RequestHandler {
  return (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    const requestId = getRequestId(req);
    const correlationId = getCorrelationId(
      req,
      requestId
    );

    const identity = getAuthenticatedIdentity(req);
    const actor = getAuditActor(req);

    if (!identity.authenticated) {
      writeAuditEvent({
        eventName: AUDIT_EVENTS.IDENTITY_MISSING,
        outcome: 'denied',
        requestId,
        correlationId,
        actor,
        action: 'authorize.request',
        method: req.method,
        path: req.path,
        statusCode: 401,
        reason:
          'No authenticated Cognito identity was available.',
        errorCode: 'AUTHENTICATION_REQUIRED',
      });

      res.status(401).json(
        buildErrorResponse(
          'AUTHENTICATION_REQUIRED',
          'Authentication is required to access this resource.',
          requestId,
          'authorization'
        )
      );

      return;
    }

    const hasPermission = identity.groups.some(
      (group) => allowedRoles.includes(group)
    );

    if (!hasPermission) {
      writeAuditEvent({
        eventName: AUDIT_EVENTS.AUTHORIZATION_DENIED,
        outcome: 'denied',
        requestId,
        correlationId,
        actor,
        action: 'authorize.request',
        method: req.method,
        path: req.path,
        statusCode: 403,
        reason: `Required role: ${allowedRoles.join(', ')}`,
        errorCode: 'FORBIDDEN',
      });

      res.status(403).json(
        buildErrorResponse(
          'FORBIDDEN',
          'You do not have permission to perform this action.',
          requestId,
          'authorization'
        )
      );

      return;
    }

    next();
  };
}

