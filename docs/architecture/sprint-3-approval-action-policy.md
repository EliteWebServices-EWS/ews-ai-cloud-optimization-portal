# Sprint 3 — Approval & Controlled Action Policy

Engineer 2 connects Sprint 2 decision readiness and the Sprint 3 ML consumer boundary to the existing execution foundation without replacing ExecutionPlan, ExecutionRun, ExecutionHistory, MFA, authorization, or ActionLog.

**ADR:** [`adr-int-13-approval-action-policy.md`](./adr-int-13-approval-action-policy.md) (`ADR-INT-13`).

Handbook-reserved intelligence ADR identifiers used by other workstreams (not this decision): `ADR-INT-06` (Longitudinal ActionLog), `ADR-INT-07` (cost evidence taxonomy), `ADR-INT-08` (verification and rollback advisory state machine), `ADR-INT-09` through `ADR-INT-12` (retention, IP process, service-plugin contract, controlled autonomy).

## Critical invariants

```text
READY != APPROVED
APPROVED != EXECUTED
ML != AUTHORITY
SIMULATION != PRODUCTION ACTION
ML failure != approval bypass
```

## Existing foundation audit

| Capability | Disposition | Location |
|------------|-------------|----------|
| ExecutionPlan / Run / History | PRESERVED | `backend/repositories/models/`, lifecycle services |
| approvalRequired / approvalStatus | PRESERVED + EXTENDED | Plan record; derived from policy when `policyContext` supplied |
| PENDING_APPROVAL / APPROVED / REJECTED | PRESERVED | `execution-lifecycle.ts`, plan repository |
| Execution authorization | PRESERVED | `execution-api-authorization.ts` |
| Privileged MFA | PRESERVED | `privileged-mfa.ts`, `require-privileged-mfa.ts` |
| Simulation vs production | PRESERVED + EXTENDED | Orchestrator `DRY_RUN` / `PRODUCTION`; `simulatePlan()` for policy-bound simulation |
| Optimistic locking | PRESERVED | `expectedVersion` on plan/run updates |
| ActionLog | EXTENDED | Approval + execution emitters at execution API seams |
| Action policy engine | NEW (minimal) | `backend/action-policy/` |
| ML inference | MISSING (Engineer 3) | Consumer boundary only |
| Override governance | DEFERRED | See override disposition below |
| Verification events | DEFERRED (Engineer 4) | Not owned by Engineer 2 |

## Action policy contract

Module: `backend/action-policy/`

Policy version: `action-policy-v1`

Evaluation output:

| Field | Values |
|-------|--------|
| `approval` | `REQUIRED` \| `NOT_REQUIRED` \| `BLOCKED` |
| `executionEligibility` | `ELIGIBLE` \| `NOT_ELIGIBLE` |
| `actionMode` | `SIMULATION` \| `PRODUCTION` |
| `reasonCodes` | Stable codes in `reason-codes.ts` |
| `policyVersion` | `action-policy-v1` |

Pure evaluator: `evaluateActionPolicy()` — consumes authoritative readiness; does not recompute Sprint 2 gates.

Actor gate helper (API/MFA seam): `evaluateActionPolicyActorGate()`.

Production execution eligibility (post-approval): `evaluateProductionExecutionEligibility()`.

## Deterministic rules (truth table)

| Readiness | Mode | Infra-changing | ML | Approval | Eligibility (pre-approval) |
|-----------|------|----------------|-----|----------|----------------------------|
| NOT_READY | any | any | any | BLOCKED | NOT_ELIGIBLE |
| READY | SIMULATION | any | permitted fallbacks | NOT_REQUIRED | ELIGIBLE |
| READY | PRODUCTION | yes | non-REJECT fallback | REQUIRED | NOT_ELIGIBLE |
| READY | PRODUCTION | no | non-REJECT fallback | NOT_REQUIRED | ELIGIBLE |
| READY | any | any | fallback REJECT | BLOCKED | NOT_ELIGIBLE |
| READY | PRODUCTION | yes | FAILED_SAFE | REQUIRED (unchanged) | NOT_ELIGIBLE until APPROVED |

ML `EXECUTED` adds `ACTION_POLICY_ML_EXECUTED_NON_AUTHORITY` — never sets approval or executes.

## Execution plan extensions

When `CreateExecutionPlanBody.policyContext` is supplied:

- Policy is evaluated at create time.
- `approvalRequired` is derived from policy (caller value overridden).
- Metadata stores provenance keys (`accountId`, `correlationId`, `decisionId`, `actionPolicySnapshot`, …).

Authoritative approval fields remain on `ExecutionPlanRecord`:

- `approvedBy`, `approvedAt`, `rejectedBy`, `rejectedAt`, `rejectionReason`
- Metadata: `approvalActorRole`, `approvalReason`

Execution history continues to append `APPROVAL_RECORDED`.

## Legacy plan safety

**Classification:** `LEGACY_GAP` (corrected) + `LEGACY_SAFE` (approval/MFA/tenant)

| Control | Legacy without `policyContext` | Policy-bound plan |
|---------|----------------------------------|-------------------|
| Decision readiness / NOT_READY | Not enforced at create | Enforced at create (`BLOCKED`) |
| Policy-derived approval | Caller-supplied `approvalRequired` | Derived from policy |
| Production execute gate | **Fail-closed** — requires stored policy snapshot | Eligibility re-checked |
| Approval lifecycle | **PRESERVED** — same PENDING/APPROVED/REJECTED flow | Same |
| Privileged MFA | **PRESERVED** — HTTP/auth layer | Same |
| Tenant isolation | **PRESERVED** — repository tenant scoping | Same |
| Simulation | **PRESERVED** — separate orchestrator `DRY_RUN` / legacy simulate route | `simulatePlan()` requires policy snapshot |

**Correction applied:** `ExecutionApiService.executePlan()` always calls `assertProductionExecutionEligible()`. Plans without `actionPolicySnapshot` metadata cannot production-mutate (`ACTION_POLICY_MISSING`).

Legacy plan **creation** and **approval lifecycle** remain compatible. Legacy **production execution** without policy provenance is no longer permitted.

## Override governance disposition

```text
OVERRIDE_GOVERNANCE_NOT_IMPLEMENTED

No production approval override path currently exists.
Sprint 3 Engineer 2 does not introduce a new override subsystem.
APPROVAL_OVERRIDDEN remains a reserved ActionLog event type only.
No actor, ML result, or API can currently invoke an override.
```

Repository audit: no `overridePlan`, `recordApprovalOverride`, or hidden approval bypass in `ExecutionApiService`, plan repositories, or lifecycle transitions. Regression tests lock this disposition.

## ActionLog integration

Emitted after persistence at execution API seams (optional `actionLogEmitter` dependency):

| Event | Stage | Source record |
|-------|-------|---------------|
| `APPROVAL_REQUIRED` | APPROVAL | plan `executionId` + version |
| `APPROVAL_GRANTED` | APPROVAL | plan + human `actorId` |
| `APPROVAL_REJECTED` | APPROVAL | plan + human `actorId` |
| `EXECUTION_STARTED` | EXECUTION | plan/run reference |
| `EXECUTION_SIMULATED` | EXECUTION | plan reference |

`APPROVAL_OVERRIDDEN` — reserved only; not emitted.

ActionLog persistence failure surfaces as `ACTION_LOG_PERSISTENCE_FAILED` (no silent drop).

## MFA / authorization

Reuse existing execution privileged roles (`TENANT_OWNER`, `SECURITY_ADMIN`) and MFA operations (`EXECUTION_APPROVE`, `EXECUTION_REJECT`, `EXECUTION_EXECUTE`).

Policy actor gate reason codes:

- `ACTION_POLICY_AUTHORIZATION_BLOCKED`
- `ACTION_POLICY_MFA_REQUIRED_BLOCKED`

## Idempotency / concurrency

Reuses existing plan `expectedVersion` optimistic locking and repository conflict semantics.

Duplicate approval on already-approved plan → lifecycle `CONFLICT`.

Stale version → `RepositoryConflictError` / mapped `CONFLICT`.

Production retry must not create duplicate mutation — orchestrator/run persistence unchanged.

## Tenant / account isolation

Plan repository tenant scoping + ActionLog emitter scope assertions unchanged.

Cross-tenant approve/execute → `RepositoryNotFoundError` / safe denial.

## ML handoff (Engineer 3)

`MlDecisionSummary` in `backend/action-policy/ml-decision-summary.ts` is the consumer boundary. Replace with authoritative Engineer 3 types when available. Do not implement inference here.

## Verification handoff (Engineer 4)

Verification ActionLog events remain Engineer 4 scope.

## SAM validation notes

- `sam validate --lint` — expected pass on `backend/template.yaml`.
- `sam build --no-cached` — CI/Linux passes per `.github/workflows/execution-validation.yml` and historical validation reports.
- Local Windows may fail in `NodejsNpmBuilder:NpmPack` with a temp-path error under `.aws-sam/build/.../node_modules/@aws-sdk/...` — classified as **PRE_EXISTING_ENVIRONMENT_FAILURE** when the same error reproduces on clean `main` (see hardening pass evidence).

## Tests

```bash
cd backend
npm run test:sprint3-approval-action-policy
```

## Known limitations

- Override governance not implemented (no existing safe override path).
- HTTP routes do not yet expose `simulatePlan`; service method available for integration/tests.
- Plan create without `policyContext` remains allowed for compatibility; production execute requires policy provenance.
