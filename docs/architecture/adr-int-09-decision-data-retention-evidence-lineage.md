# ADR-INT-09: Decision Data Retention & Evidence Lineage

## Status

Accepted — Sprint 4 Engineer 1

## Context

Sprint 3 introduced the longitudinal **ActionLog** (ADR-INT-06) as a cross-stage provenance index storing durable **references** to authoritative records. Source records live in multiple repositories with heterogeneous retention windows defined in `backend/persistence/retention.ts` and table-specific TTL attributes.

Sprint 4 must reconstruct historical decisions without fabricating missing stages and must degrade honestly when source records expire before ActionLog references.

## Decision

### RETENTION GUARANTEE (what the system does **not** guarantee)

The current architecture does **not** provide a coordinated **RETENTION GUARANTEE** that:

> If a material decision lifecycle is still retained, every authoritative source record referenced by that lifecycle is also retained for the full reconstruction window.

Verified facts:

| Store | TTL / retention in code | Table TTL (`template.yaml`) |
|-------|-------------------------|----------------------------|
| **ActionLog** | **None** — no `expiresAt`, no `retention.ts` constant | **None** on `SisumExecutionPlansTable` |
| Execution plans / history | No `expiresAt` in execution-plan DynamoDB repos | None on execution-plans table |
| Workflow / ownership | 90d (`WORKFLOW_RETENTION_SECONDS`) | TTL on other workflow tables |
| Verification (engine) | 180d (`VERIFICATION_RETENTION_SECONDS`) | TTL where verification rows are stored |
| Learning | 365d (`LEARNING_RETENTION_SECONDS`) | TTL on learning table |
| Reports / cost evidence | 180d (`REPORT_RETENTION_SECONDS`) | TTL on report table |
| Evidence / maturity / governance | Not centralized in `retention.ts` | **None** on `SisumCloudResourcesTable` |
| ML decision | ActionLog references only | Same as ActionLog |
| Audit | 365d default | TTL on audit store |

**Answer — Question A:** **PARTIALLY**. A retained ActionLog can outlive verification (180d), workflow (90d), and other shorter-lived sources. Evidence rows on cloud-resources have no table-level TTL in template, but there is still no cross-store retention contract tying ActionLog lifetime to all required sources.

Detecting missing evidence is **not** the same as guaranteeing retention. This ADR does **not** claim retention is "solved."

### SAFE RETENTION DEGRADATION (what the system **does** guarantee)

Production/default reconstruction uses **`sourceVerificationMode: 'source_verified'`**. Two reconstruction layers are distinguished:

1. **Lifecycle reconstruction** — deterministic ordering and deduplication of durable ActionLog events for a decision/correlation id.
2. **Source-verified provenance reconstruction** — lifecycle reconstruction **plus** verification that required reference-only stages resolve to authoritative records (or are ActionLog-authoritative).

When source verification is active, missing or unchecked required sources produce honest degradation:

```text
required reference-only source NOT checked
  → ProvenanceSourceReference.availability = NOT_RESOLVED
  → PROVENANCE_SOURCE_RECORD_NOT_VERIFIED
  → completeness PARTIAL (never authoritative COMPLETE)

required reference-only source lookup performed, record absent
  → availability = UNAVAILABLE
  → PROVENANCE_SOURCE_RECORD_UNAVAILABLE
  → completeness PARTIAL or INCOMPLETE (never false COMPLETE for required stages)
```

**Answer — Question B:** **Yes** — production/default reconstruction fails safely. Authoritative **COMPLETE** requires required reference-only stages to be `AVAILABLE` (or `ACTIONLOG_AUTHORITATIVE` where the ActionLog event itself is the durable authoritative record).

An explicit **`actionlog_lifecycle_diagnostic`** mode may return the ordered lifecycle chain without claiming fully source-verified completeness. It must not represent the result as authoritative **COMPLETE** for executed paths unless every required stage is ActionLog-authoritative (e.g. simulation-only paths, or ML stages where ActionLog carries the material decision facts).

### Decision-retention invariant

> A retained ActionLog lifecycle MUST NOT be classified **COMPLETE** under `source_verified` mode for a production executed path when a **required** referenced source record is `NOT_RESOLVED`, `UNAVAILABLE`, or expired due to TTL / tenant/account scope mismatch.

Completeness evaluation uses `PROVENANCE_SOURCE_RECORD_NOT_VERIFIED` (unchecked required reference) or `PROVENANCE_SOURCE_RECORD_UNAVAILABLE` (lookup performed, record missing) and degrades to **PARTIAL** or **INCOMPLETE** depending on stage criticality.

### Evidence-lineage invariant

> Reconstruction returns deterministic **source references** (`sourceStage`, `sourceRecordId`, `sourceRecordVersion`, `availability`) without duplicating full upstream payloads and without recomputing historical decisions.

Missing sources are explicit (`UNAVAILABLE`, `NOT_RESOLVED`, or `ACTIONLOG_AUTHORITATIVE`); nothing is fabricated.

**Historical decisions reconstruct from durable records — precise statement:**

- **Lifecycle reconstruction** succeeds from durable ActionLog rows (Query by decision/correlation; no Scan).
- **Authoritative provenance reconstruction** additionally requires source verification for path-required reference-only stages under `source_verified` mode.

### ActionLog retention behavior

Verified from `DynamoDbActionLogRepository`:

- ActionLog items are written to `sisum-execution-plans` with **no `expiresAt` field** and **no entry in `retention.ts`**.
- ActionLog therefore persists until an explicit future retention policy or table lifecycle rule is applied.

### Source-record retention relationships

| Record family | Retention constant | Seconds | Notes |
|---------------|-------------------|---------|-------|
| Workflow / ownership | `WORKFLOW_RETENTION_SECONDS` | 90 days | Shorter than verification |
| Verification (engine) | `VERIFICATION_RETENTION_SECONDS` | 180 days | Used by `dynamodb-verification.repository.ts` |
| Learning | `LEARNING_RETENTION_SECONDS` | 365 days | Longest standard window |
| Reports | `REPORT_RETENTION_SECONDS` | 180 days | Cost/report evidence |
| Audit | `DEFAULT_AUDIT_RETENTION_DAYS` | 365 days | Non-authoritative for reconstruction |
| ActionLog | *undefined* | *none in code* | May outlive sources |

Evidence observations on `sisum-cloud-resources` use table-level TTL not centralized in `retention.ts` — treat as **environment-configured**.

### TTL risks

1. **Stale COMPLETE claims** — mitigated by default `source_verified` mode and explicit `PROVENANCE_SOURCE_RECORD_NOT_VERIFIED` / `PROVENANCE_SOURCE_RECORD_UNAVAILABLE` reason codes.
2. **Workflow expiry before verification** — workflow context may disappear while verification (180d) remains; ActionLog retains correlation/decision ids.
3. **ActionLog immortality** — long-lived ActionLog with expired sources produces **PARTIAL** reconstruction with explicit reason codes.

### Minimum required lineage

For production executed + verified paths (non-simulation):

- Intelligence observation reference (recommendation/persistence)
- Approval resolution when `APPROVAL_REQUIRED` emitted
- Execution event
- Verification event

Optional without incompleteness:

- Cost evidence (`PROVENANCE_OPTIONAL_COST_EVIDENCE_MISSING` → PARTIAL)
- Learning outcome when `DECISION_READINESS` present without `RECOMMENDATION_DECIDED` → PARTIAL
- ML execution when `ML_SKIPPED` / `ML_FAILED_SAFE` validly recorded

### Source availability semantics

`ProvenanceSourceReference.availability`:

| Value | Meaning |
|-------|---------|
| `AVAILABLE` | Authoritative repository returned record in trusted tenant/account scope |
| `UNAVAILABLE` | Repository lookup performed; record absent (expired, deleted, or scope mismatch) |
| `NOT_RESOLVED` | Authoritative source was not checked (no resolver injected or lookup not performed) |
| `ACTIONLOG_AUTHORITATIVE` | ActionLog event itself is the durable authoritative record for that stage (e.g. ML outcome events) |

`NOT_RESOLVED` and `UNAVAILABLE` are distinct: unchecked references must not be treated as missing records.

### Stage provenance classification (material stages)

| Stage | Class | Notes |
|-------|-------|-------|
| Recommendation | REFERENCE_ONLY | Pointer to evidence observation |
| Persistence | REFERENCE_ONLY | Pointer to persistence assessment |
| Maturity | REFERENCE_ONLY | Pointer to maturity record |
| Governance | REFERENCE_ONLY | Pointer to governance result |
| Confidence | REFERENCE_ONLY | Pointer to confidence assessment |
| ML / fallback | ACTIONLOG_AUTHORITATIVE | Material fields durable on ActionLog events |
| Action policy | REFERENCE_ONLY (via approval) | Policy outcome reflected in approval/execution ActionLog; authoritative plan in execution repo |
| Approval | REFERENCE_ONLY | Path-required when approval gate applies |
| Execution | REFERENCE_ONLY | Path-required on non-simulation executed paths |
| Verification | REFERENCE_ONLY | Path-required after execution success/failure |
| Rollback execution | N/A (missing) | Advisory only until Engineer 4 |
| Learning | REFERENCE_ONLY | Optional; resolved when `RECOMMENDATION_DECIDED` and learning repo injected |

Reconstruction never infers availability from opaque ids alone.

### Deletion / offboarding considerations

- Tenant partition isolation prevents cross-tenant reads during reconstruction.
- Account scope violations fail closed with `PROVENANCE_ACCOUNT_SCOPE_VIOLATION`.
- Bulk tenant offboarding must consider ActionLog rows without TTL — future work may align ActionLog retention with longest required lineage window.

### Known limitations

- Rollback execution lifecycle not durable (ADR-INT-08 advisory only); `PROVENANCE_ROLLBACK_MISSING` → PARTIAL. **Engineer 4 dependency:** durable rollback execution lifecycle, rollback ActionLog stages, post-rollback verification provenance.
- ML `modelId` is durable on structured ActionLog field; `validatedOutput.contribution` and raw confidence are non-material operational data.
- Evidence observation TTL not centralized in `retention.ts`; cloud-resources table has no template-level TTL.
- **No RETENTION GUARANTEE** — only **SAFE RETENTION DEGRADATION** under default `source_verified` reconstruction.

### Future retention-policy work

1. Define `ACTION_LOG_RETENTION_SECONDS` aligned with maximum required lineage for material decisions.
2. Centralize cloud-resources evidence TTL constants.
3. Coordinated expiry: ActionLog reference cleanup or tombstone rows when sources expire.

## Consequences

- Historical reconstruction is honest under TTL skew.
- Operators can diagnose gaps via stable reason codes.
- No requirement to make all records permanent without architectural justification.

## References

- ADR-INT-06 Longitudinal ActionLog
- ADR-INT-08 Verification Rollback Advisory
- `docs/architecture/sprint-4-provenance-inventory.md`
- `backend/provenance-reconstruction/completeness.ts`
