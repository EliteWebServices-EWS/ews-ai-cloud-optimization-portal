# Execution API security report

## Authentication

All routes mount under global `requireAnyRole(...ALL_AUTHENTICATED_ROLES)` and `requireTenantContext()`.

## Authorization

Privileged mutations (approve, reject, execute, rollback):

- Platform Admin (`admin` group / `isPlatformAdministrator`)
- Tenant Owner (`tenant_owner` membership)
- Security Admin (`security_admin` membership)

Read/create/update (non-privileged) uses `ANALYSIS_ROLES` (analyst, admin).

## MFA

`requirePrivilegedMfa` on approve/reject/execute/rollback with operations:

- `execution.approve`
- `execution.reject`
- `execution.execute`
- `execution.rollback`

Requires trusted session MFA header/claim (`x-sisum-mfa-session-verified` / `mfa_session_verified`).

## Tenant isolation

Repository access uses trusted `tenantId` from request security context only. Cross-tenant access returns 404.

## Approval enforcement

Execute loads persisted plan, requires `APPROVED` status, validates `validateExecutionStartAllowed`, transitions with `expectedVersion`, then orchestrates from plan steps (not request body).

## Audit

New stable events: `execution.plan.created`, `execution.plan.updated`, `execution.approved`, `execution.rejected`, `execution.executed`, `execution.execution_failed`, `execution.rollback_requested`, `execution.rolled_back`, `execution.rollback_failed`.
