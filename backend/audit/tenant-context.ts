import type { AuditActor } from './audit-types';

/**
 * Default internal tenant for the single-tenant MVP.
 *
 * Full multi-tenancy is not implemented. All audit records are scoped to this
 * tenant until a trusted tenant claim is available from Cognito or tenant
 * provisioning. Do not accept tenant identifiers from arbitrary client input.
 */
export const DEFAULT_TENANT_ID = 'sisum-default';

/**
 * Resolve the tenant identifier for an audit record.
 *
 * MVP strategy: use the configured default tenant for all records. When
 * multi-tenancy is introduced, replace this with a trusted claim from the
 * authenticated identity or tenant registry — never from request body/query.
 */
export function resolveTenantId(
  _actor: AuditActor
): string {
  const configured = process.env.DEFAULT_TENANT_ID?.trim();

  if (configured && configured.length > 0) {
    return configured.slice(0, 128);
  }

  return DEFAULT_TENANT_ID;
}
