# Sprint 4 — Decision Provenance Reconstruction

## Objective

Reconstruct a historical optimization decision lifecycle from durable SISU'M records via the existing Sprint 3 **ActionLog**, without CloudWatch authority, Scan, or fabricated stages.

## Lifecycle path

```text
decision identity
  → lifecycle correlation (ActionLog Query)
  → durable provenance (source references)
  → evidence lineage (retention-aware availability)
  → reconstruction (deterministic read model)
  → retention compatibility (ADR-INT-09)
```

## Module layout

| Path | Role |
|------|------|
| `backend/provenance-reconstruction/types.ts` | Reconstruction result contract |
| `backend/provenance-reconstruction/reason-codes.ts` | Stable machine-readable codes |
| `backend/provenance-reconstruction/ordering.ts` | Dedupe + deterministic order |
| `backend/provenance-reconstruction/stage-provenance.ts` | AUTHORITATIVE vs REFERENCE_ONLY stage classification |
| `backend/provenance-reconstruction/completeness.ts` | COMPLETE / PARTIAL / INCOMPLETE (source-verified by default) |
| `backend/provenance-reconstruction/source-reference.ts` | Source availability resolution against authoritative repos |
| `backend/services/decision-provenance-reconstruction-service.ts` | Orchestration service |

## Reconstruction API

Input (trusted scope — never bypassed):

```typescript
{
  tenantId: string;
  accountId: string;
  decisionId?: string;
  correlationId?: string;
  sourceVerificationMode?: 'source_verified' | 'actionlog_lifecycle_diagnostic'; // default: source_verified
}
```

Uses existing ActionLog repository methods:

- `listByDecision`
- `listByCorrelation`

## Ordering semantics

Reuses Sprint 3 ordering:

1. `occurredAt` ascending
2. `orderKey` ascending
3. `logicalEventId` ascending

Dedupes on `logicalEventId` so duplicate delivery does not duplicate logical stages.

## Completeness policy

| Classification | Typical condition |
|----------------|-------------------|
| **COMPLETE** | Required lifecycle stages present; required reference-only sources verified (`AVAILABLE` or `ACTIONLOG_AUTHORITATIVE`) under `source_verified` mode |
| **PARTIAL** | Optional cost/learning missing, required source `NOT_RESOLVED` / `UNAVAILABLE`, or rollback execution not yet durable |
| **INCOMPLETE** | Missing approval, execution, verification, correlation gap, or lifecycle not found |

### COMPLETE_ROLLBACK vector (contract-only)

The `COMPLETE_ROLLBACK` golden fixture exercises execution-failure plus verification-insufficient ActionLog events only. ActionLog v1 has **no durable rollback execution stages** (ADR-INT-08 advisory only). The completeness evaluator therefore emits `PROVENANCE_ROLLBACK_MISSING` and classifies **PARTIAL** until Engineer 4 adds durable rollback lifecycle emitters.

### ML durable provenance

Sprint 3 persists material ML decision fields in ActionLog (`ML_ELIGIBILITY_EVALUATED`, `ML_*` outcome events): eligibility, outcome, fallback, evaluationId, modelVersion, optional structured `modelId`, evaluatedAt/inferredAt, and ML reason codes. Scope linkage (`tenantId`, `accountId`, `decisionId`, `correlationId`) is on the ActionLog events and reconstruction result root. ML inference contribution payloads and raw confidence vectors are operational diagnostics, not authorization material.

Legitimate paths:

- ML skipped / failed-safe with durable ActionLog
- Simulation (`EXECUTION_SIMULATED`) without verification requirement
- Optional cost evidence and learning outcome

### Lifecycle vs source-verified reconstruction

| Layer | What it proves | Default mode |
|-------|----------------|--------------|
| **Lifecycle reconstruction** | Durable ActionLog event chain ordered and deduped for decision/correlation | Always performed |
| **Source-verified provenance** | Required reference-only stages verified against authoritative repos (or ActionLog-authoritative) | `source_verified` (production default) |

**Historical decisions reconstruct from durable records — precise statement:**

- Lifecycle reconstruction from durable ActionLog (Query; no Scan).
- Authoritative provenance reconstruction requires required source verification for path-required reference-only stages.

### Stage provenance classification

| Stage | Class |
|-------|-------|
| Recommendation, persistence, maturity, governance, confidence | REFERENCE_ONLY |
| ML / fallback | ACTIONLOG_AUTHORITATIVE |
| Action policy (via approval plan) | REFERENCE_ONLY |
| Approval, execution, verification | REFERENCE_ONLY (path-required on executed paths) |
| Learning (`RECOMMENDATION_DECIDED`) | REFERENCE_ONLY when learning repo injected |
| Rollback execution | Missing (Engineer 4) |

### Source verification modes

| Mode | When used | Authoritative COMPLETE allowed when |
|------|-----------|-------------------------------------|
| **`source_verified`** (default) | Production reconstruction | Required lifecycle events present **and** path-required reference-only sources are `AVAILABLE` or `ACTIONLOG_AUTHORITATIVE` |
| **`actionlog_lifecycle_diagnostic`** | Explicit diagnostic / legacy compatibility | Lifecycle events present; does not claim full source verification for reference-only stages |

Source availability semantics:

| Value | Meaning |
|-------|---------|
| `AVAILABLE` | Authoritative referenced source was verified |
| `UNAVAILABLE` | Authoritative source lookup performed; record missing |
| `NOT_RESOLVED` | Authoritative source was not checked |
| `ACTIONLOG_AUTHORITATIVE` | ActionLog event is the durable authoritative record for that stage |

Reason codes: `PROVENANCE_SOURCE_RECORD_NOT_VERIFIED` (unchecked required reference) vs `PROVENANCE_SOURCE_RECORD_UNAVAILABLE` (lookup failed).

Production/default reconstruction **cannot** return authoritative **COMPLETE** when a path-required reference-only stage remains `NOT_RESOLVED`. Inject execution / verification repos and seed or lookup records to reach **COMPLETE**.

## Tenant and account isolation

Every ActionLog event must match `tenantId`. Events carrying `accountId` must match requested account. Violations throw `ProvenanceScopeError` fail-closed.

## Validation

```bash
npm run test:sprint4-provenance-reconstruction
```

Golden vectors live in `backend/tests/fixtures/sprint-4-provenance/provenance-fixtures.ts`.

## Related ADRs

- ADR-INT-06 — ActionLog foundation (Sprint 4 extension documented in § Sprint 4 extension)
- ADR-INT-09 — Retention & evidence lineage
