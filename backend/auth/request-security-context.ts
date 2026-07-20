/**
 * Trusted per-request security context including tenant boundary.
 */

import type { Request } from 'express';
import type { SisumRole } from './roles';
import {
  getAuthenticatedIdentity,
  type AuthenticatedIdentity,
} from './identity';
import {
  resolveTrustedTenantId,
  type TenantResolutionResult,
} from './tenant';
import {
  getCorrelationId,
  getRequestId,
} from '../audit/request-context';

export interface RequestSecurityContext {
  requestId: string;
  correlationId: string;
  userId: string | null;
  email: string | null;
  roles: SisumRole[];
  tenantId: string;
  claimPresent: boolean;
  usedFallback: boolean;
  invalidClaim: boolean;
}

const securityContextStore = new WeakMap<Request, RequestSecurityContext>();

export function attachRequestSecurityContext(
  req: Request,
  context: RequestSecurityContext
): void {
  securityContextStore.set(req, context);
}

export function getAttachedRequestSecurityContext(
  req: Request
): RequestSecurityContext | undefined {
  return securityContextStore.get(req);
}

/**
 * Build trusted request security context from authenticated identity.
 */
export function buildRequestSecurityContext(
  req: Request,
  identity?: AuthenticatedIdentity,
  resolution?: TenantResolutionResult
): RequestSecurityContext {
  const resolvedIdentity = identity ?? getAuthenticatedIdentity(req);
  const requestId = getRequestId(req);
  const correlationId = getCorrelationId(req, requestId);
  const tenantResolution =
    resolution ?? resolveTrustedTenantId(resolvedIdentity);

  return {
    requestId,
    correlationId,
    userId: resolvedIdentity.userId,
    email: resolvedIdentity.email,
    roles: resolvedIdentity.groups,
    tenantId: tenantResolution.tenantId,
    claimPresent: tenantResolution.claimPresent,
    usedFallback: tenantResolution.usedFallback,
    invalidClaim: tenantResolution.invalidClaim,
  };
}

/**
 * Retrieve request security context previously attached by middleware,
 * or build it on demand for authenticated routes.
 */
export function getRequestSecurityContext(
  req: Request
): RequestSecurityContext {
  const attached = getAttachedRequestSecurityContext(req);

  if (attached) {
    return attached;
  }

  const context = buildRequestSecurityContext(req);
  attachRequestSecurityContext(req, context);

  return context;
}
