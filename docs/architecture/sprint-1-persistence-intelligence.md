# Sprint 1 — Evidence Foundation & Persistence Intelligence

## Status

Accepted (Sprint 1)

## Scope

Longitudinal recommendation evidence for EC2 cost intelligence:

- append-only evidence observations in `SisumCloudResourcesTable`
- deterministic recommendation fingerprints
- persistence state classification (`NEW`, `STABLE`, `CHANGED`, `MISSING_PREVIOUS`)
- `persistence_hours` derived from observation timestamps
- tenant-scoped repository access

Out of scope: Sprint 2 maturity, Sprint 3 ML inference, Sprint 4 rollback expansion.

## Integration point

```
EC2 metrics/evidence
  → EC2 cost rules
  → getRecommendationByScope() (optional pre-read)
  → EvidencePersistenceService.recordEc2CostRecommendationObservation()
  → upsertRecommendation()
  → EvidenceObservationRepository (append-only DynamoDB item)
```

Wiring:

- `Ec2CostAnalysisOrchestrator` optional `EvidencePersistenceService` dependency
- Evidence is persisted **before** recommendation upsert when persistence is enabled
- `Ec2CostAnalysisApiService` and async consumer factory inject the service
- Async consumer passes `jobId` and worker `correlationId` into cost analysis
- No new public API endpoints in Sprint 1

## Persistence consistency (Sprint 1)

Sprint 1 does **not** guarantee cross-entity atomicity via `TransactWriteItems`.

Write ordering (when persistence is enabled):

1. Pre-read existing recommendation scope (for stable `recommendationId`)
2. Append evidence observation
3. Upsert recommendation record

### Evidence-before-intelligence (production fail-closed)

The enterprise invariant **Evidence before intelligence** applies to the EC2 cost orchestrator path.

In **production** and **staging** (`ENVIRONMENT=production|staging`), `Ec2CostAnalysisOrchestrator.run()` calls `assertEc2EvidencePersistenceRequired()` before any recommendation intelligence is persisted. If `EvidencePersistenceService` is absent, analysis fails with `PersistenceConfigurationError` and no recommendation upsert occurs.

Production composition roots (`createApp()`, `createEc2AsyncJobConsumerServiceFromEnv()`) always construct and inject `EvidencePersistenceService`. The runtime guard protects against future composition mistakes; it is not a substitute for correct wiring.

Local/test environments (`test`, `local`, `development`) may construct the orchestrator without `EvidencePersistenceService` for isolated unit and integration tests. That exception does not apply to deployed environments.

Deterministic outcomes:

| Failure point | Recommendation row | Evidence row | Retry behavior |
| --- | --- | --- | --- |
| Evidence write fails | Not written | Not written | Safe to retry full pipeline |
| Recommendation write fails after evidence | Not written | Written | Recommendation upsert succeeds on retry; see **Retry and idempotency semantics** below |
| Both succeed | Written | Written | Normal path |

This follows **Evidence before intelligence**: a failed evidence write prevents recommendation persistence.

Accepted Sprint 1 limitation: recommendation failure after successful evidence leaves a durable evidence row without a matching recommendation until retry succeeds. This is considered lower risk than recommendation-without-evidence and is healable when the retry completes successfully.

Neither failure path silently manufactures `STABLE`, `CHANGED`, or false `NEW` beyond the assessed input for that attempt.

### Retry and idempotency semantics

Evidence persistence is idempotent when the **complete logical observation identity** matches, including `observationTimestamp`. A retry of the same async analysis job with a different `observationTimestamp` is treated as a **new historical observation**.

`jobId` is provenance and does **not** independently determine evidence-observation idempotency.

`analysisRunId` identifies the analysis run (for async jobs: `{jobId}#cost`), but `observationTimestamp` also participates in logical observation identity.

#### Case A — same logical observation (duplicate delivery)

Same:

- `tenantId`
- `accountId`
- `findingKey`
- `analysisRunId`
- `observationTimestamp`

Result:

- same `logicalObservationId`
- same DynamoDB key
- idempotent replay
- no second historical observation

#### Case B — same job / same analysis run / different observation time

Same:

- `jobId` (provenance)
- `analysisRunId`

Different:

- `observationTimestamp` (typical on retry because EC2 cost analysis derives it from per-run `endTime` / metrics window end)

Result:

- different `logicalObservationId`
- different DynamoDB key
- new historical observation appended
- may classify `STABLE` if fingerprint is unchanged
- `persistence_hours` calculated from the two observation timestamps

This is intentional Sprint 1 behavior, not a duplicate-delivery replay.

#### Case C — new analysis run

Different `analysisRunId` (for example a new HTTP analysis run or a different async job).

Result:

- separate historical observation
- normal longitudinal classification applies (`NEW`, then `STABLE` / `CHANGED` as appropriate)

## Evidence observation model

Extended via `backend/persistence-intelligence/types.ts`:

| Field | Purpose |
| --- | --- |
| `tenantId`, `accountId`, `region`, `service`, `resourceType`, `resourceId` | Tenant-scoped resource identity |
| `findingKey` | Stable finding scope (existing EC2 cost key) |
| `recommendationId`, `recommendedAction`, `category`, `ruleId`, `ruleVersion` | Recommendation identity and action |
| `analysisRunId`, `jobId`, `correlationId`, `provenance` | Pipeline provenance |
| `observationTimestamp` | When evidence/recommendation was observed |
| `collectionTimestamp` | When SISU'M collected/persisted the observation |
| `persistedAt` | Repository write timestamp |
| `recommendationFingerprint` | Deterministic content fingerprint |
| `logicalObservationId` | Idempotency identity |
| `assessment` | State machine output |

### findingKey semantics

Reuses existing EC2 cost finding scope (`buildEc2CostFindingKey`). It identifies the stable finding scope for upsert/idempotency of the recommendation record. It is **not** the recommendation content fingerprint.

### logicalObservationId semantics

Deterministic SHA-256 over:

- `tenantId`
- `accountId`
- `findingKey`
- `analysisRunId`
- normalized `observationTimestamp`

Same tuple → same logical observation → idempotent redelivery. Different `analysisRunId` or `observationTimestamp` → legitimate new historical row.

`jobId` and `correlationId` are persisted for provenance but are **not** part of the idempotency tuple.

DynamoDB layout (same table/partition as cloud resources):

- `pk`: `TENANT#{tenantId}#AWS_ACCOUNT#{accountId}`
- `sk`: `EVIDENCE_OBSERVATION#FK#{findingKey}#TS#{observationTimestampIso}#LOG#{logicalObservationId}`
- `entityType`: `EVIDENCE_OBSERVATION`

No new table or GSI.

## Recommendation fingerprint

Implementation: `backend/persistence-intelligence/recommendation-fingerprint.ts`

Participating fields (EC2 cost):

- `service`, `resourceType`, `resourceId`, `region`
- `category`, `recommendedAction`, `ruleId`, `ruleVersion`
- `currentInstanceType`, `candidateInstanceType`
- `observedValues`, `thresholds`

Excluded (irrelevant to material recommendation equivalence):

- titles, summaries, severity, confidence, pricing metadata, savings estimates, lifecycle status

Normalization:

- required string fields trimmed and validated
- optional instance types normalized to `null` when absent
- object maps canonicalized via sorted-key JSON (`stableStringify`)
- EC2 `observedValues` / `thresholds` are scalar-key objects in current rules; array values preserve order intentionally (not sorted)

Hash: `SHA-256(stableStringify(payload))` with `version: 1` in payload.

## Persistence state machine

Implementation: `backend/persistence-intelligence/persistence-state-machine.ts`

| Case | Condition | State |
| --- | --- | --- |
| A | No retrievable prior evidence observation for this finding | `NEW` |
| B | Caller sets `expectedPriorHistory: true` but no prior observation can be retrieved | `MISSING_PREVIOUS` |
| C | Prior exists; fingerprint unchanged | `STABLE` |
| D | Prior exists; fingerprint changed | `CHANGED` |

Important distinctions:

- **`Ec2CostRecommendationRecord.version`** tracks recommendation-record upserts (optimistic locking / lifecycle). It is **not** evidence-history authority and does **not** trigger `MISSING_PREVIOUS`.
- **`MISSING_PREVIOUS`** means current evidence exists but expected prior **evidence observation history** is absent/unavailable — not merely that the recommendation row was updated before evidence tracking existed.
- The EC2 production path does **not** set `expectedPriorHistory`; first post-Sprint-1 evidence for an existing recommendation therefore classifies as **`NEW`**, not `MISSING_PREVIOUS`.

Duplicate logical observation (same tenant/account/findingKey/analysisRunId/observationTimestamp) is idempotent and does not append a second row.

Legitimate repeated observations at different timestamps remain separate historical rows even when fingerprint is unchanged.

## observationTimestamp semantics

EC2 cost analysis:

- **Primary:** `Ec2PerformanceEvidence.observationEnd` when instance-level metrics evidence exists. This is the end of the CloudWatch observation window used by the rule evaluation.
- **Fallback:** analysis `endTime` when instance-level metrics evidence is unavailable (for example inventory-only rules).

This timestamp represents when the evidence/recommendation was observed, **not** when SISU'M persisted the row.

## collectionTimestamp semantics

Set at evidence persistence write time in the orchestrator (`new Date().toISOString()` at upsert). Represents when SISU'M collected/persisted the observation. Never substituted for `observationTimestamp` in ordering or `persistence_hours`.

## Historical ordering authority

Primary ordering key: `observationTimestamp` ascending.

Tie-break: `logicalObservationId` lexicographic.

Relevant previous observation: latest record with `observationTimestamp` strictly less than current.

Observations sharing the exact same `observationTimestamp` are ordered deterministically by `logicalObservationId`, but they do **not** qualify as temporal priors for one another.

Repository access pattern:

- `findRelevantPreviousObservation()` queries the finding prefix in **descending** sort-key order and paginates until the first row with `observationTimestamp < current` is found.
- This avoids loading arbitrary full history and removes the prior 100-row assessment truncation bug.

Late/out-of-order inserts:

- append without rewriting prior rows
- classify against chronologically prior observation
- never produce negative `persistence_hours`

Example late arrival:

- A = `2026-08-10T10:00:00Z`
- B = `2026-08-12T10:00:00Z`
- C (late) = `2026-08-11T10:00:00Z`

C is appended, A and B remain unchanged, C is classified `STABLE` against A with `persistence_hours = 24`.

## persistence_hours

Implementation: `backend/persistence-intelligence/persistence-hours.ts`

```
persistence_hours = (current.observationTimestamp - previous.observationTimestamp) / 3_600_000
```

`persistence_hours` measures elapsed time **between observation timestamps** in the evidence history. It does **not** mean:

- retry duration
- job execution duration
- time since the first recommendation was created
- time since the previous SQS delivery

Example:

- Observation A at `2026-08-13T10:00:00Z`
- Observation B at `2026-08-13T10:02:00Z`
- Same fingerprint → `STABLE`, `persistence_hours ≈ 0.0333`

This means the system observed the same fingerprint at two observation timestamps two minutes apart. It is **not** proof that the recommendation existed continuously for two minutes in production.

Rules:

- `null` when no relevant previous observation
- `0` when timestamps are equal
- throws `PersistenceDataQualityError` if current < previous in ordered assessment
- never derived from observation count, poll count, recommendation version, or DB row count

## Provenance / correlation

Persisted on each observation:

- `analysisRunId` — EC2 cost analysis run
- `jobId` — async intelligence job ID when invoked from the EC2 job consumer
- `correlationId` — worker/request correlation ID propagated from async context
- `provenance` — defaults to `ec2-cost-analysis`

Both `jobId` and `correlationId` are supported. Async stages preserve `correlationId` through existing worker context conventions.

Neither field determines evidence-observation idempotency; see **logicalObservationId semantics** and **Retry and idempotency semantics**.

## Data quality

`PersistenceDataQualityError` (`PERSISTENCE_DATA_QUALITY_ERROR`) for:

- missing/invalid observation timestamps
- missing fingerprint inputs
- negative persistence duration in ordered assessment

Machine-readable assessment reason codes: `backend/persistence-intelligence/reason-codes.ts`.

Repository conflicts use existing `RepositoryConflictError` with conditional-write retry-to-idempotent behavior in DynamoDB repository.

## Tenant isolation

Observations inherit tenant scope from `cloudResourceAccountPartitionKey`.

Cross-tenant list/get returns empty/null; no alternate tenant lookup path.

## Known limitations

- Sprint 1 does not provide atomic recommendation+evidence transactions; see **Persistence consistency** above.
- `findRelevantPreviousObservation()` paginates through descending finding history; extremely large per-finding histories increase read cost linearly with distance from the current timestamp.
- `listObservationsForFinding()` remains paginated for audit/history reads; assessment no longer depends on a fixed 100-row cap.
- Pre-Sprint-1 recommendation upserts are not backfilled into evidence observations; first post-Sprint-1 observation for an existing recommendation is classified `NEW`, not `MISSING_PREVIOUS`.
- `expectedPriorHistory` is available for explicit caller signaling but is unused by the EC2 orchestrator path in Sprint 1.

## Tests

- `backend/tests/unit/persistence-intelligence.test.ts`
- `backend/tests/unit/sprint-1-persistence-regression.test.ts`
- `backend/tests/unit/mock-evidence-observation-repository.test.ts`
- `backend/tests/integration/ec2-cost-evidence-persistence.test.ts`
- `backend/tests/integration/sprint-1-persistence-consistency.test.ts`
- `backend/tests/integration/sprint-1-ec2-provenance-regression.test.ts`
- `backend/tests/unit/sprint-1-production-evidence-fail-closed.test.ts`

## Related code

| Area | Path |
| --- | --- |
| Core logic | `backend/persistence-intelligence/` |
| Prior query helper | `backend/repositories/evidence-observation-prior-query.ts` |
| Keys | `backend/database/cloud-resources/evidence-observation-keys.ts` |
| Contract | `backend/repositories/contracts/evidence-observation-repository.ts` |
| DynamoDB | `backend/repositories/dynamodb/dynamodb-evidence-observation-repository.ts` |
| Mock | `backend/repositories/mock/mock-evidence-observation-repository.ts` |
| Service | `backend/services/evidence-persistence-service.ts` |
| Factory | `backend/services/evidence-observation-repository-factory.ts` |
