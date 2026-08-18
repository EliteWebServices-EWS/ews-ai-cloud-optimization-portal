# ADR-INT-04: Evidence-aware confidence scoring formulation

## Status

**CURRENT IMPLEMENTATION POLICY** — `confidence-evidence-aware-v2` (Sprint 2, Engineer 3)

This ADR documents the implemented confidence engine contract. It is **not** the original approval event for Sprint 2 qualification rules. Human approval for those rules was recorded in the **Engineer 3 Phase B** architecture decision (August 2026).

## Context

Sprint 1 established a frozen six-factor commercial confidence model (`commercial-weighted-v1`) under `backend/engines/confidence/`. Sprint 2 introduced authoritative persistence assessments, evidence maturity classifications, and governance convergence outputs that confidence must consume without recomputing upstream semantics.

Engineer 3 evolved confidence decision readiness while preserving:

- frozen factor names, weights, and 80/50 thresholds
- hard fail-closed behavior for materially incomplete evidence
- separation from the EC2 fractional cost confidence helper

### Approved architecture (August 2026)

**Option B — domain-separated pipelines.** Generic `WorkflowOrchestrator` confidence and EC2 cost longitudinal evidence operate as separate production paths today. Cross-pipeline composition is **DEFERRED** to Engineer 4 / architecture integration. Confidence must **never** derive `findingKey` from `resourceId` alone.

## Decision

Implement **confidence-evidence-aware-v2** as a qualification layer over the frozen Sprint 1 commercial arithmetic.

### Dual versioning

| Field | Meaning |
| --- | --- |
| `formulaVersion = commercial-weighted-v1` | Frozen six-factor weighted arithmetic identity |
| `confidenceModelVersion = confidence-evidence-aware-v2` | Sprint 2 persistence/maturity/telemetry/governance qualification policy |

### Frozen Sprint 1 commercial formula

| Factor | Weight |
| --- | ---: |
| workload-stability | 25 |
| historical-consistency | 20 |
| recommendation-persistence | 15 |
| metrics-quality | 20 |
| evidence-completeness | 10 |
| telemetry-continuity | 10 |

Thresholds: HIGH ≥ 80, MEDIUM 50–79, LOW ≤ 49.

`ConfidenceResult.score` and `commercialScore` remain the raw commercial weighted score. Qualification never numerically rewrites the raw score.

## HUMAN-APPROVED PHASE B POLICY

The following rules were explicitly approved for Engineer 3 Phase B implementation. The code in `backend/engines/confidence/` implements these rules.

### Authoritative persistence factor mapping

When `ConfidenceRequest.longitudinalEvidence.persistence` is supplied:

| State | Factor score |
| --- | ---: |
| STABLE | 100 |
| NEW | 40 |
| CHANGED | 20 |
| MISSING_PREVIOUS | 0 |

Provider recommendation hints are ignored when authoritative persistence exists.

### Legacy fallback (no authoritative persistence)

When persistence is absent, preserve Sprint 1 provider-hint behavior (100 / 20) for the factor score, but cap final status at **MEDIUM** even when raw commercial status would be HIGH.

Reason codes:

- `CONFIDENCE_PERSISTENCE_HISTORY_ABSENT`
- `CONFIDENCE_PERSISTENCE_PROVIDER_HINT_FALLBACK`
- `CONFIDENCE_LEGACY_COMMERCIAL_FALLBACK`
- `CONFIDENCE_STATUS_CEILING_APPLIED` when the ceiling changes final status

### Maturity qualification

Maturity constrains final status only; it does not add score points.

| Maturity | Final status ceiling |
| --- | --- |
| MATURE | none |
| PARTIAL | MEDIUM |
| IMMATURE | LOW |

### Persistence-state qualification

Additional status ceilings when authoritative persistence is supplied:

| State | Ceiling |
| --- | --- |
| STABLE | none (maturity still applies) |
| NEW | MEDIUM |
| CHANGED | MEDIUM |
| MISSING_PREVIOUS | LOW |

When multiple ceilings apply, the most restrictive wins (`LOW < MEDIUM < HIGH`).

### Telemetry completeness qualification

When maturity supplies `evidenceCompleteness`:

| Completeness | Ceiling |
| --- | --- |
| COMPLETE | none |
| PARTIAL | MEDIUM |
| INSUFFICIENT | LOW |
| NO_DATA | LOW |
| NOT_APPLICABLE | none |

`NOT_APPLICABLE` is informational only and must not be penalized as missing telemetry.

Workflow-native datapoint and observation-window factor reductions remain in the raw commercial score. Observation-window and partial-metrics conditions emit reason codes without an additional status ceiling.

### Governance context

Governance convergence is **not** a seventh confidence factor and is **not** mapped into score or status in v2.

- `governanceConvergence.contextAvailable === true` → provenance only
- absent or `contextAvailable === false` → `CONFIDENCE_GOVERNANCE_CONTEXT_MISSING`

This is distinct from `GovernanceConvergenceState.MISSING`.

### Hard-invalid evidence

Preserve Sprint 1 engine fail-closed semantics:

- missing evidence → `INVALID_EVIDENCE`
- `evidenceStatus === INCOMPLETE` → `INVALID_EVIDENCE`

Do not soften these into LOW confidence.

### Qualification order

1. Calculate frozen commercial score and factor breakdown
2. Resolve raw commercial status via 80/50 thresholds
3. Collect qualification ceilings from persistence absence/state, maturity, and telemetry completeness
4. Validate source-correlation between persistence and maturity slices
5. Apply the most restrictive ceiling
6. Emit deterministic machine-readable reason codes
7. Preserve human-readable `reason` and factor `detail` fields

## CURRENT IMPLEMENTATION POLICY

The repository code implements the Phase B rules above via `calculateConfidence()` and `qualifyConfidenceStatus()`.

### persistenceHours — APPROVED H3 (provenance/consistency only)

`persistenceHours` is consumed as **authoritative longitudinal provenance and consistency evidence**. Confidence v2 does **not** independently score persistence duration and does **not** apply a separate hours-based factor modifier or status ceiling from hours alone.

Duration/history qualification is owned by **Evidence Maturity** through:

- persistence state
- `persistenceHours` (Sprint 1 last-gap delta, carried on both persistence and maturity slices)
- `stableEpochObservationCount`
- `stableEpochHours`
- maturity classification

A second confidence-specific hours modifier would double-count longitudinal evidence.

When both `persistence.persistenceHours` and `maturity.persistenceHours` are supplied for the same `sourceObservationId`, confidence performs an **exact deterministic equality** check (`null` matches `null`). On material mismatch, confidence emits `CONFIDENCE_PERSISTENCE_HOURS_MISMATCH` and applies a **LOW** status ceiling. Confidence does not fabricate or recompute hours.

### Observation history and repository access

**ConfidenceEngine** does not query persistence repositories directly. It consumes authoritative upstream summaries supplied on `ConfidenceRequest.longitudinalEvidence`:

- `PersistenceAssessment.state`
- `PersistenceAssessment.persistenceHours`
- `EvidenceMaturityAssessment.stableEpochObservationCount`
- `EvidenceMaturityAssessment.stableEpochHours`
- `EvidenceMaturityAssessment.maturity`

**ConfidenceEvidenceService** may retrieve authoritative persisted evidence for an explicit `{ tenantId, accountId, findingKey }`. The current Engineer 3 composition seam may paginate finding history; bounded single-observation retrieval is a required Engineer 4 production-wiring prerequisite. See [sprint-2-confidence-engineer-handoff.md](./sprint-2-confidence-engineer-handoff.md).

### Source-correlation validation

When persistence and maturity slices are both present:

| Condition | Behavior |
| --- | --- |
| `sourceObservationId` mismatch | `CONFIDENCE_MATURITY_SOURCE_OBSERVATION_MISMATCH`; maturity qualification disabled |
| `persistence.state` ≠ `maturity.sourcePersistenceState` (aligned observation) | `CONFIDENCE_PERSISTENCE_MATURITY_STATE_MISMATCH`; LOW ceiling |
| `persistence.persistenceHours` ≠ `maturity.persistenceHours` (aligned observation) | `CONFIDENCE_PERSISTENCE_HOURS_MISMATCH`; LOW ceiling |

### Runtime integration

**ConfidenceEngine** consumes upstream-composed `ConfidenceLongitudinalEvidence`; it does not query DynamoDB directly.

**ConfidenceEvidenceService** composes persisted persistence/maturity slices when a canonical `findingKey` is known. The generic workflow path does not fabricate finding keys from `resourceId` alone. The current composition seam uses tenant/account/finding-scoped Query pagination; bounded latest/direct observation retrieval is required before production hot-path use (Engineer 4 prerequisite).

**Cross-pipeline production composition** (Observation → Persistence → Maturity → `ConfidenceEvidenceService` → Confidence) is **DEFERRED** to Engineer 4. See [sprint-2-confidence-engineer-handoff.md](./sprint-2-confidence-engineer-handoff.md).

## Compatibility (Sprint 1 vs Sprint 2)

| Dimension | Status |
| --- | --- |
| **Arithmetic compatibility** | **PRESERVED** — frozen commercial weighted formula unchanged |
| **Schema compatibility** | **PRESERVED** — additive `commercialScore`, `confidenceModelVersion`, `reasonCodes` |
| **Status/behavior compatibility** | **INTENTIONALLY CHANGED** in `confidence-evidence-aware-v2` — final status may be lower than raw commercial threshold status |
| **Audit compatibility** | **ENHANCED** — deterministic reason codes and dual versioning |

Do not describe v2 as "fully backward compatible."

## Engineer 3 / Engineer 4 handoff

See [sprint-2-confidence-engineer-handoff.md](./sprint-2-confidence-engineer-handoff.md).

## Consequences

- Final confidence status can be lower than raw commercial status under v2 qualification.
- Existing consumers of `score`, `reason`, `factors`, and `formulaVersion` remain usable; `status` semantics intentionally evolve under v2.
- Sprint 1 golden raw-score vectors are preserved; legacy callers without longitudinal context no longer receive final HIGH status when raw commercial status is HIGH.
- EC2 fractional confidence (`ec2-cost-confidence.ts`) remains separate.

## Non-goals

- Recomputing persistence, maturity, fingerprints, or governance convergence inside confidence
- Adding a seventh confidence factor
- Merging EC2 fractional confidence into workflow confidence
- Cross-domain governance/recommendation correlation in v2
- Generic workflow auto-composition of EC2 longitudinal evidence (Engineer 4)

## Related

- `docs/architecture/sprint-1-confidence-baseline.md`
- `docs/architecture/sprint-2-confidence-engineer-handoff.md`
- `docs/architecture/adr-int-02-evidence-maturity-semantics.md`
- `docs/architecture/adr-int-03-governance-convergence-missing-semantics.md`
- `backend/engines/confidence/`
- `backend/services/confidence-evidence-service.ts`
