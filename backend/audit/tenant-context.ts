import type { AuditActor } from './audit-types';
import {
  resolveDefaultTenantId,
  resolveTrustedTenantId,
} from '../auth/tenant';
import type { AuthenticatedIdentity } from '../auth/identity';

/**
 * Default internal tenant for the single-tenant MVP.
 */
export const DEFAULT_TENANT_ID = 'sisum-default';

/**
 * Resolve the tenant identifier for an audit record from trusted context.
 *
 * Prefers an explicitly provided tenantId on the audit event. Falls back to
 * trusted identity resolution — never request body, query, or client headers.
 */
export function resolveTenantId(
  _actor: AuditActor,
  options?: {
    tenantId?: string;
    identity?: AuthenticatedIdentity;
  }
): string {
  if (options?.tenantId) {
    return options.tenantId;
  }

  if (options?.identity) {
    try {
      return resolveTrustedTenantId(options.identity).tenantId;
    } catch {
      return resolveDefaultTenantId();
    }
  }

  return resolveDefaultTenantId();
}
