# Execution API validation report

Date: 2026-07-31
Branch: `feature/execution-api`

## Implemented routes

| Method | Path |
| --- | --- |
| POST | `/api/v1/execution/plans` |
| GET | `/api/v1/execution/plans` |
| GET | `/api/v1/execution/plans/:planId` |
| PATCH | `/api/v1/execution/plans/:planId` |
| POST | `/api/v1/execution/plans/:planId/approve` |
| POST | `/api/v1/execution/plans/:planId/reject` |
| POST | `/api/v1/execution/plans/:planId/execute` |
| POST | `/api/v1/execution/plans/:planId/rollback` |
| GET | `/api/v1/execution/plans/:planId/status` |
| GET | `/api/v1/execution/runs` |
| GET | `/api/v1/execution/runs/:runId` |

DELETE is not implemented; execution plans are lifecycle-managed (no physical delete in repository contracts).

## Test commands

```bash
cd backend
npm run test:execution-api
npm run test:execution-api-integration
npm run test:execution-api-security
npm test
npm run build
```

## Approval lifecycle

Plans that require approval follow **DRAFT → PENDING_APPROVAL → APPROVED/REJECTED**. Submit with `PATCH` and `submitForApproval: true`. Approve/reject endpoints reject **DRAFT** with **409** (no automatic skip of submission).

## Production execution ordering

`executePlan` validates **APPROVED** state and approval rules, then checks `isAdapterProductionExecutionEnabled()` **before** transitioning to **EXECUTING** or invoking the orchestrator. Disabled environments return **422** `EXECUTION_PRODUCTION_DISABLED` without AWS mutation or stuck **EXECUTING** plans.

## Listing, search, and sort

Supported plan query filters (DynamoDB-backed, no Scan):

- `status` — exact lifecycle status enum
- `workflowId` — tenant-scoped index/list contract (mutually exclusive with `status`)
- `executionId` — exact plan lookup

Supported search: exact `executionId` only (not full-text).

Supported sort: repository default newest-first; `sort=createdAt` accepted; `sortOrder=asc` rejected.

## Test results (local)

Run the commands above after checkout. HTTP integration tests exercise the Express routing layer for all execution API routes (plans, approve/reject/execute/rollback, status, runs). Service and concurrency tests cover optimistic locking and production fail-closed behavior.

## Rollback duplicate contract

**Option A — conflict:** A second `POST .../rollback` after a successful rollback returns **409** `CONFLICT` (`Execution plan was already rolled back`). While a rollback is in progress (`ROLLBACK_PENDING` on the run), another request returns **409**. Adapter rollback failure returns **409** `EXECUTION_ROLLBACK_FAILED`; the plan stays **COMPLETED**/**FAILED** and the run **ROLLBACK_FAILED** may be retried. Success is always **200** with `orchestrationStatus: ROLLED_BACK` (never a non-success orchestration status on 200).

## Production execution

Live AWS adapter execution requires **both**:

- `EXECUTION_ADAPTER_PRODUCTION_ENABLED=true`
- `PROVIDER_MODE=aws`

Otherwise execute/rollback return `EXECUTION_PRODUCTION_DISABLED` (422).

## Limitations

- Plan listing search supports exact `executionId` query only (no Scan/full-text).
- Sort order is repository-defined (newest first); ascending sort rejected.
- Run listing is tenant-scoped Query/begins_with, no arbitrary filters yet.
