# Sprint 1 — Canonical Evidence Fixtures QA Report

**Status:** Implemented (Engineer 4) — **Live AWS validation complete** (see [Sprint 1 Live AWS Validation](./sprint-1-live-aws-validation.md))
**Branch:** `feature/sprint-1-evidence-fixtures`
**Fixture root:** `backend/tests/fixtures/evidence/`
**Sprint 1 release gate:** **PASS / LIVE AWS VALIDATED**

## 1. Canonical fixture catalogue

| Backlog term | Fixture export | Classification |
| --- | --- | --- |
| HEALTHY | `buildHealthyEvidence()`, `buildHealthyValidation()` | IMPLEMENTED / TESTED |
| INCOMPLETE | `buildIncompleteEvidence()`, `buildIncompleteValidation()` | IMPLEMENTED / TESTED |
| NO_DATA | `buildNoDataEvidence()`, `buildNoDataValidation()` | IMPLEMENTED / TESTED |
| NEW_RECOMMENDATION | `buildNewRecommendationScenario()` | IMPLEMENTED / TESTED |
| PERSISTENT_RECOMMENDATION | `buildPersistentRecommendationScenario()` | IMPLEMENTED / TESTED |
| CHANGED_RECOMMENDATION | `buildChangedRecommendationScenario()` | IMPLEMENTED / TESTED |
| MISSING_PREVIOUS | `buildMissingPreviousScenario()` | IMPLEMENTED / TESTED |
| MISSING_PRICING | `buildMissingPricingEvidence()`, `buildMissingPricingValidation()` | IMPLEMENTED / TESTED |
| GOVERNANCE_FAILURE | `buildGovernanceFailureResult()` | IMPLEMENTED / TESTED |
| ML_INELIGIBLE | `buildMlIneligibleDecision()` | IMPLEMENTED / TESTED (fixture-only; no production ML path) |
| POST_ACTION_SUCCESS | `buildPostActionSuccessVerification()`, `buildPostActionSuccessObservation()` | IMPLEMENTED / TESTED (contract fixtures only) |
| POST_ACTION_DEGRADATION | `buildPostActionDegradationVerification()`, `buildPostActionDegradationObservation()` | IMPLEMENTED / TESTED (contract fixtures only) |

## 2. Fixture locations and public exports

Barrel export: `backend/tests/fixtures/evidence/index.ts`

| Module | Purpose |
| --- | --- |
| `identities.ts` | `TENANT_A`, `TENANT_B`, accounts, regions, resource IDs, fixed timestamps |
| `standardized-evidence.ts` | Workflow evidence + validation builders |
| `observation-builders.ts` | `RecordEvidenceObservationInput` / `EvidenceObservationRecord` builders |
| `persistence-scenarios.ts` | Named persistence scenarios + `replayPersistenceScenario()` |
| `ec2-cost-scenarios.ts` | EC2 stopped-instance seed + finding key helpers |
| `confidence-results.ts` | `buildConfidenceResult()` with frozen `formulaVersion` |
| `governance-fixtures.ts` | Blocked governance result fixture |
| `ml-fixtures.ts` | Sprint 3 MLDecision fixture representations |
| `lifecycle-fixtures.ts` | Sprint 4 verification/observation contract fixtures |

## 3. Persistence scenarios

| Scenario | Expected states | Test coverage |
| --- | --- | --- |
| PERSISTENT / STABLE (A) | NEW → STABLE → STABLE | Catalogue + mock + DynamoDB |
| CHANGED (B) | NEW → CHANGED | Catalogue + mock + DynamoDB |
| MISSING_PREVIOUS (C) | MISSING_PREVIOUS | Catalogue + mock + DynamoDB |
| Duplicate logical observation | idempotent replay | Catalogue + mock + DynamoDB |
| Same job, different timestamp | NEW → STABLE | Catalogue |
| Out-of-order A/C/late B | NEW → STABLE → STABLE | Catalogue + mock + DynamoDB |
| 100+ historical rows | STABLE prior selection | Catalogue + regression test |
| Malformed timestamp | repository error | Catalogue + DynamoDB |

## 4. Duplicate / replay scenarios

- `buildDuplicateObservationScenario()` — IMPLEMENTED / TESTED
- `buildSameJobDifferentTimestampScenario()` — IMPLEMENTED / TESTED
- Existing sprint-1-persistence-consistency retry tests — preserved (not duplicated)

## 5. Out-of-order scenarios

- `buildOutOfOrderObservationScenario()` — IMPLEMENTED / TESTED (mock + DynamoDB + existing regression tests refactored to shared builders)

## 6. Missing-history scenario

- `buildMissingPreviousScenario()` with `expectedPriorHistory: true` — IMPLEMENTED / TESTED

## 7. Malformed-observation scenario

- `buildMalformedObservationScenario()` — IMPLEMENTED / TESTED (expects `PersistenceDataQualityError`)

## 8. DynamoDB adapter coverage

New file: `backend/tests/unit/dynamodb-evidence-observation-repository.test.ts`

Uses existing `FakeDocumentClient` via `createLinkedFakePersistenceTables()`.

Covers: insert, duplicate idempotency, NEW/STABLE/CHANGED/MISSING_PREVIOUS, prior lookup, out-of-order, cross-tenant read protection, malformed timestamp rejection.

Classification: **IMPLEMENTED / TESTED**

## 9. Tenant-isolation coverage

New file: `backend/tests/integration/sprint-1-evidence-tenant-isolation.test.ts`

Covers: cross-tenant list denial, cross-tenant logical lookup, independent append partitions, cross-account denial, resource/finding-key separation.

Classification: **IMPLEMENTED / TESTED**

HTTP/API evidence observation isolation: **NOT YET IMPLEMENTED** (no Sprint 1 public observation API).

## 10. Golden-path coverage

New file: `backend/tests/integration/sprint-1-evidence-golden-path.test.ts`

| Path | Status |
| --- | --- |
| Workflow evidence → frozen commercial confidence | IMPLEMENTED / TESTED |
| EC2 cost → evidence observation → recommendation | IMPLEMENTED / TESTED |
| Persistence states → commercial confidence | DOCUMENTED BOUNDARY — not connected in Sprint 1 |

Full single-pipeline “stored decision” spanning workflow + EC2 persistence: **NOT YET IMPLEMENTED** (no production contract links the paths).

## 11. Test-layer reuse

Fixtures consumed by unit, repository, and integration tests. Existing tests refactored to import shared builders where duplication was removed.

Browser E2E: **OUT OF SCOPE** — no Playwright/Cypress framework; fixtures structured for future reuse.

## 12. CI execution

Added npm script:

```bash
npm run test:sprint1-evidence-fixtures
```

Main `.github/workflows/ci.yml` still does not run backend tests (pre-existing). Targeted local/CI script follows existing `test:ec2-cost-intelligence` conventions.

## 13. Known limitations

- No browser E2E framework
- No DynamoDB Local workflow dedicated to evidence fixtures (uses in-memory fake client)
- ML and lifecycle fixtures are contract representations only
- Workflow persistence states (NEW/STABLE/CHANGED) are not confidence inputs in Sprint 1
- Main CI workflow does not execute backend tests automatically

## 14. Deferred Sprint 2/3/4 work

- Evidence maturity engine (`MATURE` / `PARTIAL` / `IMMATURE`)
- ML execution / fallback production logic
- Post-action verification engine integration using lifecycle fixtures
- Cross-domain unified evidence envelope
- Public evidence observation API fixtures

## 15. Production defects discovered

### PD-1 — LIVE AWS VALIDATED

| Field | Detail |
| --- | --- |
| Status | **LIVE AWS VALIDATED** |
| Root cause | `buildEc2CostFindingKey()` emits composite EC2 finding keys containing `#`; `evidenceObservationSortKey()` previously validated `findingKey` via `requireKeyValue()`, which rejects `#` |
| Production fix | `backend/database/cloud-resources/evidence-observation-keys.ts` — `findingKey` validation now uses `requireOpaqueKeyValue()` in both `evidenceObservationSortKey()` and `evidenceObservationSortKeyPrefixForFinding()`; EC2 finding-key format unchanged |
| Regression test | `backend/tests/unit/dynamodb-evidence-observation-repository.test.ts` — production-shaped EC2 finding keys from `buildEc2CostFindingKey()` containing `#` |
| Validated locally | Targeted DynamoDB evidence observation repository tests; Sprint 1 fixture suite; build; full backend regression |
| Live AWS proof | Evidence observations persisted with composite finding keys containing `#` (see [Sprint 1 Live AWS Validation](./sprint-1-live-aws-validation.md)) |
| Note | `buildDynamoSafeFindingKey()` remains for simplified generic adapter scenarios only; it is no longer required for production EC2 key compatibility |

### PD-2 — stage completion proof consistency (production hardening)

| Field | Detail |
| --- | --- |
| Status | **Production hardening — live path validated** |
| Fix | Strongly consistent `{ consistentRead: true }` on async stage-proof `getRun()` reads |
| Scope note | Did not alone fix the cost-stage CloudWatch failure; an independent `GetMetricData` request-shape defect was found later (PD-4) |

### PD-3 — CloudWatch failure diagnostics

| Field | Detail |
| --- | --- |
| Status | **Diagnostics implemented — root cause identified in live AWS** |
| Live result | Exposed `awsErrorName=ValidationError`, `awsHttpStatusCode=400` for `GetMetricData` without logging raw messages, stacks, credentials, or payloads |
| Scope note | Diagnostic only — **not** the behavioral fix |

### PD-4 — CloudWatch GetMetricData request shape

| Field | Detail |
| --- | --- |
| Status | **ROOT CAUSE CONFIRMED / FIX DEPLOYED / LIVE AWS VALIDATED** |
| Root cause | Top-level `MetricDataQuery.Period` mutually exclusive with `MetricStat` when `MetricStat.Period` is present |
| Fix | Remove top-level `Period`; preserve `MetricStat.Period` |
| Live proof | Post-fix async job `job-idem-0693c0b806e7673074d3361f61793d7f` — cost run `SUCCEEDED`, `instancesEvaluated=1`, `warnings=[]` (see [Sprint 1 Live AWS Validation](./sprint-1-live-aws-validation.md)) |

## 16. Live AWS validation and release gate

**Authoritative record:** [sprint-1-live-aws-validation.md](./sprint-1-live-aws-validation.md)

| Layer | Status |
| --- | --- |
| Local / fixture validation | **IMPLEMENTED / TESTED** (sections 1–14 above) |
| Live AWS validation | **PASS** — real EC2 workload in account `572262081497`, region `us-east-1`, instance `i-0ce183611f7fc8ed2` |
| Sprint 1 release gate | **PASS / LIVE AWS VALIDATED** |

Release-gate proof summary:

- First observation: `NEW`, `persistenceHours = null`
- Second observation: `STABLE`, `persistenceHours = 2.6530827777777777`, `PERSISTENCE_FINGERPRINT_UNCHANGED`, `comparedToObservationId` recorded

Non-blocking follow-ups (dashboard Avg CPU, NaN utilization rendering, pricing unavailable) are documented in the live validation report and do **not** invalidate this gate.

---

**Confirmations**

- No duplicate persistence engine created
- Commercial confidence formula unchanged
- No Sprint 2/3 production semantics added
- No commit or push performed as part of this work item
