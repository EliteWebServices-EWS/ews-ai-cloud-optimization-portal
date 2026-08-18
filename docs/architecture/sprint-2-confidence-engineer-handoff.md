# Sprint 2 — Confidence Engineer 3 / Engineer 4 Handoff

**Status:** APPROVED architecture freeze (August 2026)

**Branch:** `feature/sprint-2-evidence-aware-confidence`

## Approved architecture

**Option B — domain-separated pipelines.** Generic workflow confidence and EC2 cost longitudinal evidence are separate production paths. The absence of generic workflow `findingKey` propagation is an **approved architecture boundary**, not an Engineer 3 coding defect.

**Identity rule:** Never derive `findingKey` from `resourceId` alone.

## ENGINEER 3 — CURRENT (complete at engine/service boundary)

| Deliverable | Location |
| --- | --- |
| `confidence-evidence-aware-v2` qualification layer | `backend/engines/confidence/` |
| Frozen commercial formula (`commercial-weighted-v1`) | `confidence.scoring.ts`, `confidence.config.ts` |
| Authoritative persistence factor contract | `confidence.scoring.ts` — state-based when `longitudinalEvidence.persistence` supplied |
| Maturity / telemetry qualification ceilings | `confidence.qualification.ts` |
| Safe degradation + legacy fallback | `confidence.qualification.ts` |
| Deterministic reason codes | `backend/shared/confidence/reason-codes.ts` |
| Source-correlation validation | `confidence.qualification.ts` — observation ID, persistence state, `persistenceHours` |
| `ConfidenceEvidenceService` composition seam | `backend/services/confidence-evidence-service.ts` — correct, tenant/account/finding scoped; **no production caller** |
| Golden vectors + boundary tests | `backend/tests/unit/confidence*.test.ts` |
| Qualified downstream status semantics | `RecommendationEngine` consumes `confidence.status` |

### persistenceHours policy (H3)

`persistenceHours` is **provenance/consistency only** in confidence. Evidence Maturity owns duration/history interpretation via `persistenceHours`, `stableEpochObservationCount`, `stableEpochHours`, and maturity classification. Confidence does not apply a separate hours-based score or ceiling.

### Observation history (ConfidenceEngine)

**ConfidenceEngine** does not query persistence repositories directly. It consumes authoritative upstream summaries supplied on `ConfidenceRequest.longitudinalEvidence`:

- `PersistenceAssessment.state`
- `PersistenceAssessment.persistenceHours`
- `EvidenceMaturityAssessment.stableEpochObservationCount`
- `EvidenceMaturityAssessment.stableEpochHours`
- `EvidenceMaturityAssessment.maturity`

**ConfidenceEvidenceService** may retrieve authoritative persisted evidence for an explicit `{ tenantId, accountId, findingKey }`. The current Engineer 3 composition seam may paginate finding history; bounded single-observation retrieval is a required Engineer 4 production-wiring prerequisite (see below). This is **not** a current production defect — there is no production caller today.

## ENGINEER 4 — DEFERRED

| Deliverable | Notes |
| --- | --- |
| Canonical cross-pipeline finding identity | Propagate unchanged EC2 cost `findingKey` when convergence is wired |
| Production caller for `ConfidenceEvidenceService` | EC2 cost or approved convergence layer — **not** generic workflow without finding scope |
| Observation → Persistence → Maturity → Confidence E2E proof | Real cross-layer integration test |
| Convergence / release-gate integration tests | Sprint 2 acceptance: immature evidence cannot produce unexplained HIGH confidence **on the production convergence path** |
| Bounded observation retrieval | Required before production hot-path wiring (see prerequisite below) |

### Engineer 4 prerequisite — bounded observation access (before production hot path)

**Before** `ConfidenceEvidenceService` is wired into a production hot path, Engineer 4 must:

1. **Replace full-history latest lookup** with a bounded scoped lookup.
2. **Prefer `getObservationByLogicalId`** when canonical logical identity is known (`tenantId`, `accountId`, `findingKey`, `analysisRunId`, `observationTimestamp`).
3. **Add `getLatestObservationForFinding`** (repository method) when latest lookup is required, using:
   - `tenantId` + `accountId` + `findingKey` scope
   - DynamoDB **Query** (not Scan)
   - `ScanIndexForward: false`
   - `Limit: 1`
4. **Preserve identity safety:** tenant/account/finding scoping; no Scan; no `resourceId`-derived `findingKey`.
5. **Add tests:** Mock/DynamoDB parity; `>100` observation pagination/order; equal-timestamp ordering.

The current Engineer 3 service implementation paginates entire finding history to resolve one row. The access-pattern audit confirmed this is **correct and deterministic under current ordering**, but **unbounded with respect to history size**. Optimization is deferred to Engineer 4 — not a defect in the frozen Engineer 3 engine/service contract.

### Engineer 4 contract for `ConfidenceEvidenceService`

```text
Input:  { tenantId, accountId, findingKey, sourceObservationId?, governanceContextAvailable? }
Output: ConfidenceLongitudinalEvidence | undefined
Rules:  explicit findingKey only; no resourceId inference;
        omit maturity on sourceObservationId mismatch;
        undefined → confidence v2 legacy fallback (no fabricated STABLE/MATURE)
Pass to: ConfidenceEngine.execute({ ..., longitudinalEvidence: composed })
```

## Engineer 3 Definition of Done (reclassified)

| Criterion | Status |
| --- | --- |
| Confidence model versioned | **PASS** |
| Persistence factor uses authoritative persistence | **PASS** at engine/service contract boundary |
| `persistenceHours` requirement | **PASS** under H3 provenance/consistency |
| Observation history requirement | **PASS** via authoritative summaries |
| Maturity integrated | **PASS** |
| Safe degradation deterministic | **PASS** |
| Reason codes | **PASS** |
| Golden vectors | **PASS** |
| Boundary tests | **PASS** |
| Generic workflow auto-composition | **DEFERRED TO ENGINEER 4** |
