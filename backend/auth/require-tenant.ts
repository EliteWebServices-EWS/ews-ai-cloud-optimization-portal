/**
 * Middleware that resolves and attaches trusted tenant context.
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
  scheduleAuditPersistence,
  writeAuditEvent,
} from '../audit';
import { buildErrorResponse } from '../shared/utils';
import { getAuthenticatedIdentity } from './identity';
import {
  attachRequestSecurityContext,
  buildRequestSecurityContext,
} from './request-security-context';
import {
  InvalidTenantClaimError,
  TenantRequiredError,
  resolveTrustedTenantId,
} from './tenant';

export function requireTenantContext(): RequestHandler {
  return (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    const identity = getAuthenticatedIdentity(req);
    const actor = getAuditActor(req);

    try {
      const resolution = resolveTrustedTenantId(identity);
      const context = buildRequestSecurityContext(
        req,
        identity,
        resolution
      );

      attachRequestSecurityContext(req, context);

      if (!resolution.claimPresent) {
        const event = writeAuditEvent({
          eventName: AUDIT_EVENTS.TENANT_CLAIM_MISSING,
          outcome: 'denied',
          requestId: context.requestId,
          correlationId: context.correlationId,
          actor,
          tenantId: context.tenantId,
          action: 'tenant.resolve',
          method: req.method,
          path: req.path,
          reason:
            'Authenticated request missing tenant_id access-token claim; compatibility fallback applied.',
        });

        scheduleAuditPersistence(req, event);
      }

      if (resolution.usedFallback) {
        const event = writeAuditEvent({
          eventName: AUDIT_EVENTS.TENANT_FALLBACK_USED,
          outcome: 'success',
          requestId: context.requestId,
          correlationId: context.correlationId,
          actor,
          tenantId: context.tenantId,
          action: 'tenant.resolve',
          method: req.method,
          path: req.path,
          reason: resolution.invalidClaim
            ? 'Invalid tenant claim replaced with configured default tenant.'
            : 'Missing tenant claim replaced with configured default tenant.',
        });

        scheduleAuditPersistence(req, event);
      }

      next();
    } catch (error) {
      const requestId = req.header('x-request-id') ?? 'unknown';
      const correlationId =
        req.header('x-correlation-id') ?? requestId;

      if (error instanceof TenantRequiredError) {
        const event = writeAuditEvent({
          eventName: AUDIT_EVENTS.TENANT_CLAIM_MISSING,
          outcome: 'denied',
          requestId,
          correlationId,
          actor,
          action: 'tenant.resolve',
          method: req.method,
          path: req.path,
          statusCode: 403,
          reason: error.message,
          errorCode: error.code,
        });

        scheduleAuditPersistence(req, event);

        res.status(403).json(
          buildErrorResponse(
            error.code,
            error.message,
            requestId,
            'authorization'
          )
        );

        return;
      }

      if (error instanceof InvalidTenantClaimError) {
        const event = writeAuditEvent({
          eventName: AUDIT_EVENTS.TENANT_CLAIM_MISSING,
          outcome: 'denied',
          requestId,
          correlationId,
          actor,
          action: 'tenant.resolve',
          method: req.method,
          path: req.path,
          statusCode: 403,
          reason: error.message,
          errorCode: error.code,
        });

        scheduleAuditPersistence(req, event);

        res.status(403).json(
          buildErrorResponse(
            error.code,
            error.message,
            requestId,
            'authorization'
          )
        );

        return;
      }

      next(error);
    }
  };
}
