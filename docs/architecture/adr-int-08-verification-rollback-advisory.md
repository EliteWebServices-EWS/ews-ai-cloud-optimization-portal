# ADR-INT-08: Verification and Rollback Advisory State Machine

## Status

Accepted — Sprint 3 Engineer 4

## Context

The repository already ships a legacy `VerificationEngine` with comparator semantics (`PENDING`, `VERIFIED`, `PARTIAL`, `FAILED`). Sprint 3 requires post-action enterprise outcomes without replacing that engine or creating `VerificationEngineV2`.

**Enterprise Handbook reservation:** `ADR-INT-08` = Verification and rollback advisory state machine.

Critical invariants:

```text
API SUCCESS != OPTIMIZATION SUCCESS
VERIFIED TECHNICAL EXECUTION != RESOLVED RECOMMENDATION
INSUFFICIENT_EVIDENCE != SUCCESS
ROLLBACK_CANDIDATE != ROLLBACK AUTHORIZATION
HEALTHY != RESOLVED
```

## Decision

1. Preserve legacy comparator semantics and status vocabulary unchanged.
2. Introduce Sprint 3 `PostActionVerificationAssessment` as a composed enterprise layer in `backend/post-action-verification/`.
3. Keep engine `VerificationRepository` (`backend/engines/verification/verification.repository.ts`) authoritative for post-action persistence; extend `VerificationOutput` with optional `accountId` and `assessment`.
4. Reuse generic `VerificationRecord` only through explicit adapter `toVerificationRecordFromOutput()` — no third repository.
5. Integrate ActionLog with `VERIFICATION_STARTED`, `VERIFICATION_COMPLETED`, `VERIFICATION_INSUFFICIENT_EVIDENCE` via thin stage adapters; ActionLog never calculates verification.
6. Treat `ROLLBACK_CANDIDATE` as advisory only — Sprint 4 owns rollback authorization/execution.

## Legacy vs Sprint 3 outcomes

| Legacy comparator | Sprint 3 assessment | Notes |
|-------------------|---------------------|-------|
| `VERIFIED` | `HEALTHY` or `RESOLVED` | `RESOLVED` requires explicit recommendation absence |
| `PARTIAL` | `DEGRADED` | measurable shortfall |
| `FAILED` | `DEGRADED` or `ROLLBACK_CANDIDATE` | rollback advisory requires measurable degradation evidence |
| `PENDING` | `INSUFFICIENT_EVIDENCE` | missing execution/observation/telemetry |

## Sprint 3 assessment contract

Each assessment includes:

- `outcome`: `HEALTHY` \| `DEGRADED` \| `RESOLVED` \| `INSUFFICIENT_EVIDENCE` \| `ROLLBACK_CANDIDATE`
- `reasonCodes`
- `evaluatedAt`
- `verificationPolicyVersion` (`post-action-verification-v1`)
- evidence references: execution, before, after, recommendation state, telemetry, expected impact, observed impact
- `comparatorResult` (legacy technical result)

Recommendation resolution uses explicit post-action recommendation evidence — never execution status alone.

## Repository convergence

| Layer | Role |
|-------|------|
| Engine repository | Authoritative for `VerificationEngine` + Sprint 3 post-action persistence |
| Generic repository | Versioned platform CRUD; optional adapter sync only |
| Third repository | **Not created** |

## Tenant/account isolation

Verification assessment requires explicit `tenantId`, `accountId`, and matching `evidenceContextScope`. Cross-tenant and cross-account evidence scope is rejected with `PostActionVerificationScopeError`. Repository lookups remain tenant-partitioned with safe not-found semantics.

## ActionLog integration

`PostActionVerificationService` / emitter record authoritative assessments only:

- start → `VERIFICATION_STARTED`
- persisted non-insufficient outcome → `VERIFICATION_COMPLETED`
- `INSUFFICIENT_EVIDENCE` → `VERIFICATION_INSUFFICIENT_EVIDENCE`

Duplicate emission remains idempotent via ActionLog canonical identity.

## Sprint 4 handoff

Sprint 4 implements rollback authorization and execution control. Sprint 3 emits `ROLLBACK_CANDIDATE` advisory state only when measurable degradation evidence exists.
