# Sprint 2 — Evidence Maturity Engine

## Objective

Deterministically classify longitudinal EC2 cost evidence as `IMMATURE`, `PARTIAL`, or `MATURE` after Sprint 1 persistence assessment, without modifying Sprint 1 observation semantics.

## Model version

**`evidence-maturity-v1`** — persisted on every assessment record.

## Approved v1 thresholds

| Policy | Value |
| --- | --- |
| `MATURE_MIN_OBSERVATION_COUNT` | 3 |
| `MATURE_MIN_STABLE_EPOCH_HOURS` | 24 |
| `PARTIAL_MIN_OBSERVATION_COUNT` | 2 |

Centralized in `backend/evidence-maturity/maturity-config.ts`. Classification reads these constants via `qualifiesForMature()` — **not** via score normalization.

## Field semantics

### `observationCount` / `stableEpochObservationCount`

Both fields report the **count of observations in the current stable epoch** (same persisted `recommendationFingerprint` suffix). They are identical in v1.

Example sequence `A, A, A, B, B, B` evaluated at the last `B`:

- `observationCount = 3`
- `stableEpochObservationCount = 3`
- **Not** total history (6)

### `persistenceHours` (Sprint 1 — immutable)

Time delta between the current observation timestamp and the **single relevant previous** Sprint 1 observation (last-gap semantics). Does **not** span the full stable epoch.

### `stableEpochHours`

`latest current-epoch observation timestamp − earliest current-epoch observation timestamp` (hours). May differ from `persistenceHours`.

## Current stable epoch

The **current stable epoch** is the uninterrupted sequence of observations ending at the current observation that share the same **persisted** `recommendationFingerprint`. A fingerprint change starts a new epoch; prior fingerprints do not contribute (e.g. `A, A, B, A` → final `A` epoch count = 1).

Computed by `computeCurrentStableEpoch()` using observation timestamps (not insertion order).

## Classification rules (v1)

| Persistence state | Maturity |
| --- | --- |
| `NEW` | `IMMATURE` |
| `MISSING_PREVIOUS` | `IMMATURE` |
| `CHANGED` | `IMMATURE` (epoch reset) |
| `STABLE` + epoch & telemetry gates | `PARTIAL` or `MATURE` |

### MATURE requires ALL

- `sourcePersistenceState === STABLE`
- `stableEpochObservationCount >= 3`
- `stableEpochHours >= 24` (from `matureMinStableEpochHours` config)
- Telemetry `NOT_APPLICABLE` **OR** telemetry `COMPLETE`

### PARTIAL

- `sourcePersistenceState === STABLE`
- `stableEpochObservationCount >= 2`
- `stableEpochHours > 0`
- One or more MATURE gates not satisfied, and no IMMATURE terminal gate applies

### Telemetry

Reuse EC2 taxonomy: `COMPLETE | PARTIAL | INSUFFICIENT | NO_DATA`.

Applicability: `REQUIRED | NOT_APPLICABLE`. Unknown rule/category combinations default to **REQUIRED** (conservative).

| Applicability | Completeness | Max maturity |
| --- | --- | --- |
| REQUIRED | `NO_DATA` | `IMMATURE` |
| REQUIRED | `INSUFFICIENT` | `IMMATURE` |
| REQUIRED | `PARTIAL` | `PARTIAL` |
| REQUIRED | `COMPLETE` | eligible for `MATURE` |
| NOT_APPLICABLE | — | history gates only; missing CloudWatch object is **not** `NO_DATA` |

Inventory examples: `STOPPED_WITH_STORAGE`, `INSTANCE_FAMILY_UPGRADE` → `NOT_APPLICABLE`.

## Score semantics

0–100 factor checklist (`persistence-state`, `stable-epoch-observation-count`, `stable-epoch-duration-hours`, `telemetry-quality`). **Classification is rule-driven first**; score is explanatory only and **cannot** override maturity. No `if (score >= X) maturity = …` logic exists.

## Cost evidence (deferred)

Cost evidence is **not** an authoritative classification input to `evidence-maturity-v1`. The maturity contract preserves an extension point for the Sprint 2 canonical cost-evidence taxonomy (Engineer 4). No `pricingStatus` or pricing state is treated as positive or negative maturity evidence in v1.

## ML eligibility (deferred)

ML eligibility is **not** an input to `evidence-maturity-v1`. The canonical ML eligibility/safe-degradation contract is implemented in a later convergence stage (Engineer 3). Maturity-v1 is deterministic and independent of confidence scores and ML outputs.

## Governance (deferred)

Governance readiness/convergence (Engineer 2) is not consumed by maturity-v1.

## Persistence

- **Table:** Cloud Resources (same as Sprint 1)
- **PK:** `TENANT#{tenantId}#AWS_ACCOUNT#{accountId}`
- **SK:** `EVIDENCE_MATURITY_ASSESSMENT#FK#{findingKey}#TS#{sourceObservationTimestampIso}#OBS#{sourceLogicalObservationId}#MV#{modelVersion}`
- **entityType:** `EVIDENCE_MATURITY_ASSESSMENT`
- Append-only / idempotent Put; no table scans

List-by-finding uses scoped Query with `ScanIndexForward: true`; sort key `#TS#{sourceObservationTimestampIso}` provides natural source-observation chronological ascending order across pages.

## Identity and timestamp semantics

**Logical maturity identity (duplicate protection):**

`tenantId + accountId + findingKey + sourceLogicalObservationId + modelVersion`

**Physical chronological timestamp (sort key segment):**

`sourceObservationTimestamp` — normalized immutable timestamp from `sourceObservation.observationTimestamp`. Drives deterministic PK+SK and list ordering.

**`evaluatedAt`:** when the maturity evaluator ran (audit provenance only). Excluded from DynamoDB identity because retries of the same logical evaluation may occur at different wall-clock times.

**`persistedAt`:** when the maturity record was durably written (write provenance only). Not part of identity or list ordering.

## Idempotency identity

`tenantId + accountId + findingKey + sourceLogicalObservationId + modelVersion`

## EC2 integration

After successful `recordEc2CostRecommendationObservation()`, orchestrator invokes `EvidenceMaturityService.evaluateAndPersist()`. Maturity technical failure adds a run warning; Sprint 1 observation remains durable. Recommendation existence ≠ evidence maturity success.

## Technical failure vs business immaturity

- Business insufficiency (`NEW`, `MISSING_PREVIOUS`, `CHANGED`, insufficient telemetry/history) → valid persisted `IMMATURE`/`PARTIAL`
- Evaluator/repository/serialization failure → typed error; **no** fabricated maturity record

## Out-of-order observations

Historical maturity records are immutable snapshots. Late observations receive new assessments; prior records are not rewritten. List order follows source observation timestamp ascending (T1, T2, T3) regardless of write order.

## Known limitations

- Maturity evaluates evidence available at assessment time; out-of-order arrivals do not retroactively update prior maturity records.
- Orchestrator uses wall-clock `Date.now()` for observation timestamps when CloudWatch evidence is absent.

## Related code

| Area | Path |
| --- | --- |
| Core logic | `backend/evidence-maturity/` |
| Service | `backend/services/evidence-maturity-service.ts` |
| Repository | `backend/repositories/dynamodb/dynamodb-evidence-maturity-repository.ts` |
| Keys | `backend/database/cloud-resources/evidence-maturity-keys.ts` |
