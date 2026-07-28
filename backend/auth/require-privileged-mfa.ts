/**
 * Express middleware enforcing MFA for privileged tenant-administration operations.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import {
  AUDIT_EVENTS,
  getAuditActor,
  scheduleAuditPersistence,
  writeAuditEvent,
} from '../audit';
import { buildErrorResponse } from '../shared/utils';
import { getAuthenticatedIdentity } from './identity';
import {
  evaluatePrivilegedMfa,
  PRIVILEGED_OPERATIONS,
  type PrivilegedOperation,
} from './privileged-mfa';
import { getRequestSecurityContext } from './request-security-context';

const PRIVILEGED_MFA_DENIED_MESSAGE =
  'Multi-factor authentication is required to perform this operation. Current-session MFA evidence is not available on this access token.';

function denyPrivilegedMfa(
  req: Request,
  res: Response,
  input: {
    operation: string;
    errorCode: 'MFA_EVIDENCE_UNAVAILABLE';
    reason: string;
  },
): void {
  const context = getRequestSecurityContext(req);
  const actor = getAuditActor(req);

  scheduleAuditPersistence(
    req,
    writeAuditEvent({
      eventName: AUDIT_EVENTS.PRIVILEGED_MFA_REQUIRED,
      outcome: 'denied',
      requestId: context.requestId,
      correlationId: context.correlationId,
      actor,
      tenantId: context.tenantId,
      action: input.operation,
      method: req.method,
      path: req.path,
      statusCode: 403,
      reason: input.reason,
      errorCode: input.errorCode,
    }),
  );

  scheduleAuditPersistence(
    req,
    writeAuditEvent({
      eventName: AUDIT_EVENTS.PRIVILEGED_MFA_DENIED,
      outcome: 'denied',
      requestId: context.requestId,
      correlationId: context.correlationId,
      actor,
      tenantId: context.tenantId,
      action: input.operation,
      method: req.method,
      path: req.path,
      statusCode: 403,
      reason: input.reason,
      errorCode: input.errorCode,
    }),
  );

  res.status(403).json(
    buildErrorResponse(
      input.errorCode,
      PRIVILEGED_MFA_DENIED_MESSAGE,
      context.requestId,
      'authorization',
    ),
  );
}

export function requirePrivilegedMfa(
  operation: PrivilegedOperation,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const identity = getAuthenticatedIdentity(req);
    const context = getRequestSecurityContext(req);
    const actor = getAuditActor(req);

    const evaluation = evaluatePrivilegedMfa(context, identity, operation);

    if (!evaluation.required) {
      next();
      return;
    }

    if (evaluation.satisfied) {
      const verifiedEvent = writeAuditEvent({
        eventName: AUDIT_EVENTS.PRIVILEGED_MFA_VERIFIED,
        outcome: 'success',
        requestId: context.requestId,
        correlationId: context.correlationId,
        actor,
        tenantId: context.tenantId,
        action: operation,
        method: req.method,
        path: req.path,
        statusCode: 200,
        reason:
          'Trusted current-session MFA evidence present on access token (mfa_session_verified).',
      });

      scheduleAuditPersistence(req, verifiedEvent);
      next();
      return;
    }

    denyPrivilegedMfa(req, res, {
      operation,
      errorCode: 'MFA_EVIDENCE_UNAVAILABLE',
      reason:
        'Privileged operation requires current-session MFA evidence; Cognito access token did not provide mfa_session_verified.',
    });
  };
}

export function assertPrivilegedRoleChangeMfa(
  req: Request,
  res: Response,
  input: {
    targetRole?: string;
    requesterTenantRole?: string;
  },
): boolean {
  const identity = getAuthenticatedIdentity(req);
  const context = getRequestSecurityContext(req);
  const actor = getAuditActor(req);

  const evaluation = evaluatePrivilegedMfa(
    context,
    identity,
    PRIVILEGED_OPERATIONS.TENANT_PRIVILEGED_ROLE_CHANGE,
    {
      targetTenantRole: input.targetRole as never,
      requesterTenantRole: input.requesterTenantRole as never,
    },
  );

  if (!evaluation.required || evaluation.satisfied) {
    if (evaluation.required && evaluation.satisfied) {
      scheduleAuditPersistence(
        req,
        writeAuditEvent({
          eventName: AUDIT_EVENTS.PRIVILEGED_MFA_VERIFIED,
          outcome: 'success',
          requestId: context.requestId,
          correlationId: context.correlationId,
          actor,
          tenantId: context.tenantId,
          action: 'membership.privileged_role_change',
          method: req.method,
          path: req.path,
          statusCode: 200,
        }),
      );
    }
    return true;
  }

  denyPrivilegedMfa(req, res, {
    operation: 'membership.privileged_role_change',
    errorCode: 'MFA_EVIDENCE_UNAVAILABLE',
    reason:
      'Privileged role change requires current-session MFA evidence; not available on this access token.',
  });

  return false;
}
