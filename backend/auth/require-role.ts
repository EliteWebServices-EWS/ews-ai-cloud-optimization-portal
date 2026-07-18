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
  buildErrorResponse,
  generateRequestId,
} from '../shared/utils';
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
    const requestId = generateRequestId();
    const identity = getAuthenticatedIdentity(req);

    if (!identity.authenticated) {
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

    const hasPermission = identity.groups.some((group) =>
      allowedRoles.includes(group)
    );

    if (!hasPermission) {
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