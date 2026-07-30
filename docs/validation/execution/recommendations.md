# Execution validation recommendations

Date: 2026-07-30
Branch: `feature/execution-validation`

## Required before production

1. **Enforce plan approval at the execution API boundary** — Ensure no PRODUCTION orchestrator call accepts unapproved plans when `approvalRequired` is true (repository rules alone are insufficient if orchestrator is reachable directly).
2. **Confirm execution-run DynamoDB table and IAM in target environment** — Factory fail-closed behavior is unit-tested; deployment must set table env vars and policies.
3. **Run `execution-validation` workflow** (or equivalent) in CI/CD before release promotion.

## Recommended shortly after production

1. **Approval audit events** — Emit `AUDIT_EVENTS` (new stable names) on approve/reject with actor and execution ID.
2. **DynamoDB Local integration tests for execution runs** — Mirror execution-plans table script for runs/history if not already deployed.
3. **Staging perf sample** — Run performance test with higher `EXECUTION_VALIDATION_ITERATIONS` against DynamoDB Local.
4. **Logs Insights dashboards** — Execution success rate, rollback rate, validation failure breakdown by service.

## Future enhancements

1. End-to-end test: approved plan → workflow step → orchestrator PRODUCTION → history append.
2. Idempotency keys for duplicate execution requests at API layer.
3. Broader adapter contract matrix (resource-not-found, verify mismatch) per action catalog.
4. Separate verification audit events if verification stage becomes independently observable.

All items above are recommendations; controls listed in security/safety reports were verified only where covered by tests in this branch.
