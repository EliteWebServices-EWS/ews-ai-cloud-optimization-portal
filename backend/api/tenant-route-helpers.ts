/**
 * Shared helpers for tenant-aware API route handlers.
 */

import type { Request } from 'express';
import {
  AUDIT_EVENTS,
  getAuditActor,
  scheduleAuditPersistence,
  writeAuditEvent,
} from '../audit';
import {
  checkTenantOwnership,
  getRequestSecurityContext,
  type RequestSecurityContext,
} from '../auth';
import { AppError } from '../shared/utils';

export function resolveRouteTenantContext(
  req: Request
): RequestSecurityContext {
  return getRequestSecurityContext(req);
}

export function recordTenantAccessDenied(
  req: Request,
  input: {
    resourceType: string;
    resourceId: string;
    method?: string;
    path?: string;
  }
): void {
  const context = resolveRouteTenantContext(req);
  const actor = getAuditActor(req);

  const event = writeAuditEvent({
    eventName: AUDIT_EVENTS.TENANT_ACCESS_DENIED,
    outcome: 'denied',
    requestId: context.requestId,
    correlationId: context.correlationId,
    actor,
    tenantId: context.tenantId,
    action: 'tenant.access',
    method: input.method ?? req.method,
    path: input.path ?? req.path,
    statusCode: 404,
    resource: {
      type: input.resourceType,
      id: input.resourceId,
    },
    reason:
      'Cross-tenant resource access was denied without exposing ownership.',
    errorCode: 'NOT_FOUND',
  });

  scheduleAuditPersistence(req, event);
}

/**
 * Return 404 when a resource is missing or owned by another tenant.
 */
export function throwTenantScopedNotFound(
  resourceType: string,
  resourceId: string,
  label = resourceType
): never {
  throw new AppError(
    'NOT_FOUND',
    `${label} not found: ${resourceId}`,
    404
  );
}

export function assertTenantResourceAccess(
  req: Request,
  input: {
    recordTenantId: string | undefined;
    resourceType: string;
    resourceId: string;
    label?: string;
  }
): void {
  const context = resolveRouteTenantContext(req);
  const guard = checkTenantOwnership({
    requestTenantId: context.tenantId,
    recordTenantId: input.recordTenantId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
  });

  if (!guard.allowed) {
    if (guard.crossTenantAttempt) {
      recordTenantAccessDenied(req, {
        resourceType: input.resourceType,
        resourceId: input.resourceId,
      });
    }

    throwTenantScopedNotFound(
      input.resourceType,
      input.resourceId,
      input.label
    );
  }
}
