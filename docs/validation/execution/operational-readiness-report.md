# Operational readiness report

Date: 2026-07-30
Branch: `feature/execution-validation`

## Build status

| Check | Result |
| --- | --- |
| `npm run build` (backend) | Success |
| `sam validate --lint` | Valid SAM template |
| `sam build --no-cached` | Build succeeded |

## Test status

| Check | Result |
| --- | --- |
| `npm run test:execution-validation` | 138/138 pass |
| `npm test` (full backend) | 637 pass, 0 fail, 5 skipped |
| Conflict marker scan | None in backend/docs/.github |

## Deployment template validation

`backend/template.yaml` validates and builds with SAM. Execution plans table and execution-related IAM patterns remain as on main (Sprint 12.5 + execution adapters merge).

## Production execution path trace (2026-07-30 verification)

Static trace from HTTP/Lambda entry through to `ExecutionOrchestrator` (no code changes in this verification).

| Step | Finding |
| --- | --- |
| Lambda entry | `backend/lambda.ts` → `handler` → `createApp({ identitySource: 'lambda-adapter' })` |
| Express bootstrap | `backend/index.ts` → `createApp` wires `createExecutionSimulator()` and `createWorkflowOrchestrator({ … executionSimulator … })` — **does not** import `createExecutionOrchestrator`, `createExecutionRepositories`, or `ExecutionPlanRepository` |
| HTTP routes | `backend/api/routes/index.ts` → `createApiRoutes` mounts workflow and verification routers only |
| Workflow “execution” | `POST /api/v1/workflows/run` → `WorkflowOrchestrator.executeWorkflow` → `runPipeline` → `simulateExecution` → `ExecutionSimulator.simulate` (`backend/orchestrator/workflow.orchestrator.ts` ~757–767) |
| Demo/simulate API | `POST /api/v1/execution/simulate` → `executionSimulator.simulate` (`createVerificationRoutes` ~1256–1315) |
| AWS adapter orchestrator | `ExecutionOrchestrator.run` is defined in `backend/execution/execution-orchestrator.ts` and exported from `backend/execution/index.ts`, but **no production `.ts` file outside tests calls `createExecutionOrchestrator` or `.run()`** (grep: only `execution-orchestrator.ts`, `execution/index.ts`, and tests) |
| Execution plans in API | `createExecutionPlanRepository` / `createExecutionRepositories` are used only in `backend/services/execution-repository-factory.ts` and unit tests — **no API route or service loads an `ExecutionPlanRecord` before any orchestrator call** |

**Conclusion:** The reported gap (“orchestrator PRODUCTION without APPROVED persisted plan”) is **not reachable** in the current deployed application shape, because **`ExecutionOrchestrator` is not on any production call chain**. Live HTTP execution today is the **mock** `ExecutionSimulator`, which does not call AWS adapters or persist execution runs via the adapter orchestrator.

When the adapter orchestrator is wired in, callers must load the plan, enforce approval (`transitionStatus` / `validateExecutionStartAllowed`), tenant scope, and optimistic locking — that remains a **future integration** requirement, not a present bypass.

## Logging and auditability

- Structured audit logging for execution and rollback lifecycle is implemented on the **adapter orchestrator** code path (unit/integration tests); that path is **not** invoked by the Express/Lambda app today.
- Production API emits `execution.simulated` / workflow audit events for the simulator/workflow path.
- CloudWatch-friendly event names defined in `audit-events.ts`.
- Plan approval changes are durable on plan records when repositories are used; dedicated approval audit events are not present.

## Rollback readiness

- Adapters and orchestrator implement rollback after verification failure in code and tests.
- **Production API does not invoke this path today**; rollback readiness applies when AWS orchestration is integrated.

## Production readiness decision

### **READY WITH CONDITIONS** (adapter stack and persistence contracts)

**Rationale:** Validated libraries (adapters, orchestrator, plan/run repositories, lifecycle rules) build and test cleanly. The **approval-orchestrator gap is not an active production vulnerability** because nothing in `createApp` / API routes calls `ExecutionOrchestrator`.

**Conditions before enabling live AWS execution in production:**

1. Wire `ExecutionOrchestrator` only through a service that loads the tenant-scoped `ExecutionPlan`, transitions to `EXECUTING` with `expectedVersion`, and relies on repository approval rules (or equivalent explicit checks).
2. Add explicit approval audit events if compliance requires an immutable trail beyond plan records.
3. Extend CI/deployment with execution-run DynamoDB table bootstrap when runs are persisted in production.

**Separate note:** Treat **current API “execution”** (workflow + `ExecutionSimulator`) as mock/demo execution, not AWS adapter PRODUCTION mode.
