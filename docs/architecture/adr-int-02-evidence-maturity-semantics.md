# ADR-INT-02: Evidence maturity semantics and reason-code taxonomy

## Status

Accepted (Sprint 2, model v1)

## Context

Sprint 1 established append-only evidence observations and persistence states (`NEW`, `STABLE`, `CHANGED`, `MISSING_PREVIOUS`). The enterprise handbook proposed `IMMATURE` / `PARTIAL` / `MATURE` taxonomy without an implemented engine (see `docs/architecture/sprint-1-evidence-governance-mapping.md` I-14).

## Decision

Implement **evidence-maturity-v1** as a distinct append-only assessment family on the Cloud Resources table, consuming Sprint 1 outputs without modifying persistence semantics.

### Approved v1 policy

**Model version:** `evidence-maturity-v1`

**MATURE** requires ALL:

- `sourcePersistenceState === STABLE`
- ≥ 3 observations in the **current stable epoch** (`stableEpochObservationCount`)
- ≥ 24 hours current stable epoch duration (`stableEpochHours`, from `matureMinStableEpochHours`)
- Telemetry `NOT_APPLICABLE` OR telemetry `COMPLETE`

**PARTIAL**:

- `sourcePersistenceState === STABLE`
- ≥ 2 current-epoch observations
- Positive stable-epoch duration
- One or more MATURE gates not satisfied (includes telemetry `PARTIAL`), provided no IMMATURE terminal gate applies

**NEW** → `IMMATURE`

**MISSING_PREVIOUS** → `IMMATURE`

**CHANGED** → `IMMATURE` (resets epoch; no inheritance)

### Field semantics

- `observationCount` = current stable epoch count (identical to `stableEpochObservationCount` in v1)
- `persistenceHours` = Sprint 1 last-gap delta (unchanged)
- `stableEpochHours` = earliest-to-latest timestamp span within current stable epoch

### Reason codes

Stable `MATURITY_*` machine-readable codes in `backend/evidence-maturity/reason-codes.ts`.

### Score

Deterministic 0–100 factor checklist; secondary to classification. Score cannot determine maturity.

### Persistence identity and ordering

- **Logical identity:** `tenantId + accountId + findingKey + sourceLogicalObservationId + modelVersion`
- **Physical sort key timestamp:** `sourceObservationTimestamp` from the source evidence observation (normalized ISO)
- **`evaluatedAt`:** evaluator wall-clock provenance only; excluded from DynamoDB identity because concurrent retries may differ
- **`persistedAt`:** durable-write provenance only
- List order: source observation timestamp ascending

### Cost evidence (deferred)

Cost evidence is not an authoritative classification input to `evidence-maturity-v1`. The maturity contract preserves an extension point for the Sprint 2 canonical cost-evidence taxonomy. No pricing state is treated as positive or negative maturity evidence in v1 unless explicitly integrated by a later versioned policy.

### ML eligibility (deferred)

ML eligibility is not an input to `evidence-maturity-v1` because the canonical ML eligibility/safe-degradation contract is implemented in a later convergence stage. Maturity-v1 is deterministic and independent of ML.

## Consequences

- Maturity assessments are auditable, idempotent, and tenant/account/finding scoped.
- Historical maturity records retain their model version.
- Cost evidence, governance, and ML dimensions remain deferred to other engineers.
- EC2 orchestrator continues after maturity technical failure; evidence observations are never rolled back.

## Related

- `docs/architecture/sprint-2-evidence-maturity.md`
- `backend/evidence-maturity/maturity-config.ts`
