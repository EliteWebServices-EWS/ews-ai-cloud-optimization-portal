# Sprint 3 — Longitudinal ActionLog

## Purpose

ActionLog is the durable, append-only decision lifecycle provenance layer for SISU'M. It links authoritative stage outputs across:

```text
recommendation → persistence → maturity → governance → confidence
→ decision readiness → ML → approval → execution → verification
```

CloudWatch logs are **not** authoritative lifecycle storage.

## Status labels

| Area | Status |
|------|--------|
| ActionLog repository/service/factory | **IMPLEMENTED** |
| DynamoDB projection repair-on-retry | **IMPLEMENTED** |
| `ActionLogEmitter` + stage adapters | **IMPLEMENTED** |
| Evidence persistence emitter wiring | **IMPLEMENTED** (requires `correlationId` on observation input) |
| Evidence maturity emitter wiring | **IMPLEMENTED** (requires `actionLogContext` on evaluate call) |
| Decision readiness emitter wiring | **IMPLEMENTED** (requires `actionLogContext` on assess call) |
| Governance production batch wiring | **INTENTIONALLY DEFERRED** (typed adapter only; batch seam not yet stable) |
| ML / approval / verification emitters | **INTENTIONALLY DEFERRED** (Engineers 2/3/4) |
| ActionLog HTTP API | **INTENTIONALLY DEFERRED** |
| Full Sprint 3 lifecycle in production | **KNOWN LIMITATION** — Sprint 1/2 subset only |

## Boundary

| Mechanism | Role |
|-----------|------|
| **Operational audit** (`sisum-audit`) | Security/compliance request and actor trail |
| **Execution history** (`EXECUTION_HIST`) | Execution-domain plan/status audit |
| **Verification records** (`sisum-verifications`) | Verification outputs and workflow indexes |
| **ActionLog** (`ACTION_LOG`) | Cross-decision intelligence provenance with stage references |

ActionLog records references emitted by authoritative stages. It does **not** recompute intelligence or policy.

## Runtime composition — **IMPLEMENTED**

Factory: `backend/services/action-log-repository-factory.ts`

| Mode | Resolution |
|------|------------|
| Deployed + `EXECUTION_PLANS_TABLE_NAME` | `DynamoDbActionLogRepository` on `sisum-execution-plans-${Environment}` |
| Local/test (`PERSISTENCE_ENABLED=false`) | `MockActionLogRepository` |
| Deployed without table config | `PersistenceConfigurationError` (fail closed) |

Service: `createActionLogService()` → `ActionLogService`

Production bootstrap (`backend/index.ts`):

- `createActionLogService()` + `ActionLogEmitter`
- Wired into `EvidencePersistenceService`, `EvidenceMaturityService` (optional emitter parameter)
- `DecisionReadinessService` accepts optional emitter (callers pass `actionLogContext`)

No second DI container.

## Emitter boundary — **IMPLEMENTED**

`backend/action-log/action-log-emitter.ts` + `stage-adapters.ts`

Responsibilities:

- Accept already-computed upstream records/results
- Preserve explicit tenant/account/resource/finding/correlation scope
- Map to `RecordActionLogEventInput` via typed adapters (no business logic)
- Delegate to `ActionLogService`
- Throw `ActionLogPersistenceError` on persistence failure (never silent)

Decision scope: `resolveActionLogDecisionId({ correlationId, findingKey, recommendationId })` — never inferred from `resourceId` alone.

## Real Sprint 1/2 integration points

| Stage | Integration | Status |
|-------|-------------|--------|
| Recommendation + persistence | `EvidencePersistenceService.recordObservation` when `correlationId` present | **IMPLEMENTED** |
| Maturity | `EvidenceMaturityService.evaluateAndPersist` when `actionLogContext` present | **IMPLEMENTED** |
| Governance | `ActionLogEmitter.emitAfterGovernanceResult` + `buildGovernanceEvaluatedEventInput` | **IMPLEMENTED** (adapter); production batch hook **DEFERRED** |
| Confidence + readiness | `DecisionReadinessService.assess` when `actionLogContext` present | **IMPLEMENTED** |

Governance deferral reason: `GovernanceConvergenceService.persistForSecurityAnalysisRun` is a multi-row batch path without a single stable post-commit hook; wiring there would require broader orchestration changes outside Engineer 1 scope.

## ID / correlation mapping

| Upstream identity | ActionLog reference |
|-------------------|---------------------|
| Evidence observation | `sourceRecordId = observationId`, version = observation `version` |
| Persistence assessment | `sourceRecordId = logicalObservationId`, version = assessment `ruleVersion` |
| Maturity assessment | `sourceRecordId = assessmentId`, version = `modelVersion` |
| Governance result | `sourceRecordId = resultId`, version = `ruleVersion` |
| Confidence | `sourceRecordId = {recommendationId}#confidence`, version = `formulaVersion` |
| Decision readiness | `sourceRecordId = recommendationId`, version = `policyVersion` |
| Lifecycle join | `correlationId` (required), `decisionId` derived explicitly |

## Event identity — **IMPLEMENTED**

- `logicalEventId`: logical domain occurrence (idempotency key)
- `eventId`: stored ActionLog row identity
- **v1 intentional:** `eventId === logicalEventId` on canonical rows

Default logical identity hash:

```text
SHA-256(tenantId, correlationId, eventType, sourceStage, sourceRecordId, sourceRecordVersion?)
```

`correlationId` in the tuple prevents separate lifecycle chains sharing a source record from collapsing.

## Partial-write / retry guarantees — **IMPLEMENTED**

DynamoDB writes:

1. Conditional Put canonical row
2. On duplicate canonical → load existing canonical record
3. `ensureProjectionRows` writes all applicable index rows with conditional Put (repair-on-retry)

Invariant: retry after partial failure completes missing correlation/decision/execution/resource projections without duplicate rows.

## Execution-plans table safety — **IMPLEMENTED**

Table: `sisum-execution-plans-${Environment}`

| Check | Result |
|-------|--------|
| Prefix collision with `EXECUTION#`, `EXECUTION_HIST#`, `EXECUTION_RUN#` | None (`ACTION_LOG#…` namespace) |
| Cross-query pollution | Prevented by distinct `begins_with` prefixes |
| Execution pagination/conditionals | Unchanged (separate SK prefixes) |
| TTL on execution-plans table | **None** — ActionLog rows not TTL-expired |
| IAM | Reuses existing execution-plans table grants (`PutItem`/`Query`/`GetItem`) |
| Hot partition risk | **KNOWN LIMITATION** — tenant PK concentration; monitor item growth per lifecycle |
| Retention | Compatible with execution-plans retain policy; no ActionLog-specific TTL in Sprint 3 |

## Failure semantics — **IMPLEMENTED**

Authoritative stage persists first; ActionLog emit is a **retryable side-effect**:

1. Upstream repository/service completes (observation/maturity/readiness result returned only after upstream write)
2. Emitter persists ActionLog
3. On ActionLog failure → `ActionLogPersistenceError` propagates
4. Upstream result is **not** rolled back or recomputed
5. Caller may retry emitter/repository call idempotently

ActionLog durability is **not** required for upstream material write acknowledgment in v1, but failures are explicit and retryable. Material history must not exist only in CloudWatch.

## Storage layout

| Item | PK | SK |
|------|----|----|
| Canonical | `TENANT#{tenantId}` | `ACTION_LOG#LOG#{logicalEventId}` |
| Correlation index | same | `ACTION_LOG#CORR#…` |
| Decision index | same | `ACTION_LOG#DEC#…` |
| Execution index | same | `ACTION_LOG#EXEC#…` |
| Resource index | same | `ACTION_LOG#RES#{accountId}#{resourceId}#…` |

## Sprint 4 handoff

Sprint 4 provenance audit should consume bounded ActionLog queries and compare against audit/execution history boundaries. Engineer 2/3/4 emit ML/approval/verification events through the same emitter contract.

## Module map

```text
backend/action-log/                     types, identity, emitter, adapters
backend/services/action-log-repository-factory.ts
backend/services/action-log-service.ts
backend/repositories/dynamodb/dynamodb-action-log-repository.ts
backend/database/execution/action-log-keys.ts
```

Test script: `npm run test:sprint3-action-log`
