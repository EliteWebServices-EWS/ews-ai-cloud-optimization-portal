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
    resourceTenantId: string;
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
    resourceTenantId: input.resourceTenantId,
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

/**
 * Handle a tenant-scoped lookup miss by distinguishing cross-tenant access
 * from genuinely missing resources.
 */
export function handleTenantScopedResourceMiss(
  req: Request,
  input: {
    resourceType: string;
    resourceId: string;
    ownerTenantId: string | undefined;
    label?: string;
  }
): never {
  const context = resolveRouteTenantContext(req);

  if (
    input.ownerTenantId !== undefined &&
    input.ownerTenantId !== context.tenantId
  ) {
    recordTenantAccessDenied(req, {
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      resourceTenantId: input.ownerTenantId,
    });
  }

  throwTenantScopedNotFound(
    input.resourceType,
    input.resourceId,
    input.label
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
    if (guard.crossTenantAttempt && input.recordTenantId !== undefined) {
      recordTenantAccessDenied(req, {
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        resourceTenantId: input.recordTenantId,
      });
    }

    throwTenantScopedNotFound(
      input.resourceType,
      input.resourceId,
      input.label
    );
  }
}
