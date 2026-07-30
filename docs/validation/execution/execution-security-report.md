# Execution security report

Date: 2026-07-30
Branch: `feature/execution-validation`

## Tenant isolation findings

Verified via `execution-tenant-isolation.test.ts` and plan/run CRUD integration tests:

- Cross-tenant `getById`, `update`, and approval decisions return `RepositoryNotFoundError` or undefined (safe not-found).
- Execution run records are not visible across tenants.
- Pagination tokens are scoped by tenant and query type; cross-scope tokens raise `InvalidPaginationTokenError` when a continuation token exists.

## Authorization findings

- Orchestrator rejects empty `tenantId` with `ExecutionAdapterError` (`TENANT_REQUIRED` path via adapters).
- Unsupported actions are rejected at the registry before validation or AWS calls.
- HTTP-layer MFA and tenant-admin rules were not modified; execution-specific tests do not replace API middleware tests.

## Approval enforcement

- Lifecycle graph prevents DRAFT or PENDING_APPROVAL from transitioning directly to EXECUTING (`InvalidExecutionTransitionError`).
- REJECTED plans cannot move to EXECUTING.
- `validateExecutionStartAllowed` (unit-tested) blocks EXECUTING when `approvalRequired` is true and `approvalStatus !== APPROVED`.
- Stale approval updates fail with `RepositoryConflictError`.

**Note:** Blocking unapproved execution is enforced primarily through **plan status transitions**, not a separate orchestrator approval gate.

## MFA implications

Privileged MFA applies to tenant administration routes (Sprint 12 patterns). Execution validation tests call the orchestrator and repositories directly; MFA is **not** re-tested here. No MFA bypass was introduced.

## Audit coverage

Constants verified: `execution.started`, `execution.succeeded`, `execution.failed`, `rollback.started`, `rollback.completed`, `rollback.failed`.

Orchestrator emits structured audit logs on production execution paths (observed in unit test output). There are **no** dedicated `validation.started` / `approval.granted` audit event names in `AUDIT_EVENTS`; plan approval is persisted on the plan record.

## Rollback state protection

- Rollback uses adapter-captured configuration stored on the execution run record during PRODUCTION flow (integration rollback test).
- Client-supplied rollback payloads are not used as the source of truth in orchestrator design.

## Concurrency protection

- Optimistic locking on plan and run updates (`RepositoryConflictError` on stale version).
- Concurrent execution start attempts on runs tested in `execution-concurrency.test.ts`.

## Optimistic locking

Plan and run repositories increment version on successful updates; stale `expectedVersion` updates fail with conflict errors.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Orchestrator callable without plan approval | Wire API/workflow to require APPROVED plan before PRODUCTION mode; enforce in route layer |
| Limited approval audit trail | Add explicit audit events on `recordApprovalDecision` if compliance requires |
| Mock-only integration path | Keep DynamoDB planner tests in CI; optional DynamoDB Local execution-run tests later |
