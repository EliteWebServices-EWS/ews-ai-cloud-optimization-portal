# Execution safety report

Date: 2026-07-30
Branch: `feature/execution-validation`

## Execution preconditions

- Orchestrator requires explicit `mode` (VALIDATION, DRY_RUN, PRODUCTION).
- Adapters require tenant, actor, and region on validate/execute paths.
- Registry rejects unknown services and unsupported actions before adapter work.

## Approval controls

- Plans requiring approval must follow DRAFT → PENDING_APPROVAL → APPROVED before EXECUTING is a valid transition.
- Direct EXECUTING from DRAFT or PENDING_APPROVAL is rejected.
- Rejected plans cannot execute.

## Simulation behavior

- **VALIDATION:** runs adapter validation only; does not persist execution runs.
- **DRY_RUN:** builds dry-run plan after successful validation; does not invoke mutating SDK commands (EC2 StartInstances verified in rollback/simulation tests).
- Failed validation returns `VALIDATION_FAILED` without persistence.

## Unsupported action handling

- Registry-level unsupported actions throw `ExecutionAdapterError` (`UNSUPPORTED_ACTION`).
- Adapter-level parameter validation returns structured validation errors.

## Failure recovery

- Verification failure on PRODUCTION path triggers rollback attempt; failures preserved on run record (`ROLLED_BACK`, rollback result fields).
- Audit events logged for failure and rollback stages (orchestrator unit tests).

## Rollback integrity

- Rollback eligibility determined by adapter; state captured before execute.
- Tenant-scoped run repository prevents cross-tenant rollback targeting.
- `execution-rollback-integrity.test.ts` asserts persisted rollback metadata is used.

## Concurrency controls

- Stale plan/run updates rejected.
- Tests exercise concurrent transition attempts where supported by mock repository.

## Tenant isolation

- Enforced at repository keying (`tenantId#executionId` / run tenant scope).
- Cross-tenant access returns not-found or undefined per convention.

## Remaining risks

- Single orchestrator entry point without mandatory plan-status check if invoked from new code paths.
- Rollback success depends on adapter correctness and AWS eventual consistency (mocked in tests).
