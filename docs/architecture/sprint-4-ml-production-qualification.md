# Sprint 4 — ML Production Qualification & Safe-Degradation Stress Testing

Engineer 3 qualifies the existing Sprint 3 ML decision boundary against abnormal, incomplete, and adversarial operating conditions. ML remains intelligence, never authority.

**ADR:** [`adr-int-05-ml-safe-degradation.md`](./adr-int-05-ml-safe-degradation.md) (`ADR-INT-05`, updated in place).

## Architectural invariant

```text
Evidence
→ ML eligibility
→ inference when eligible
→ output validation
→ bounded ML contribution
→ deterministic governance/action policy
```

On failure:

```text
missing / invalid / unavailable ML
→ SKIPPED or FAILED_SAFE
→ deterministic fallback / observe / reject
```

## ML production qualification

Qualification is a **read model** over existing Sprint 3 results (`backend/ml-production-qualification/`). It classifies a test snapshot as:

| Result | Meaning |
|--------|---------|
| `PRODUCTION_QUALIFIED` | Sprint 3 boundary held: every decision has a legal outcome, reason codes, and EXECUTED requires validated output |
| `NOT_QUALIFIED` | Snapshot is empty, claims ML authority, or contains an unsafe/unexplained decision |
| `DEFERRED` | Live external model/provider integration is present — not part of this sprint |

`qualifyMlProductionBoundary()` must not be called as a runtime substitute for `MlDecisionService`.

## Eligibility stress matrix

| Condition | Eligibility | Outcome | Reason code |
|-----------|-------------|---------|-------------|
| Insufficient observations | `ML_INELIGIBLE` | `SKIPPED` | `ML_INELIGIBLE_INSUFFICIENT_HISTORY` |
| Insufficient persistence | `ML_INELIGIBLE` | `SKIPPED` | `ML_INELIGIBLE_INSUFFICIENT_PERSISTENCE` |
| Immature evidence | `ML_INELIGIBLE` | `SKIPPED` | `ML_INELIGIBLE_EVIDENCE_IMMATURE` |
| Partial / unknown telemetry | `ML_INELIGIBLE` | `SKIPPED` | `ML_INELIGIBLE_TELEMETRY_QUALITY` |
| Missing feature | `ML_INELIGIBLE` | `SKIPPED` | `ML_SKIPPED_FEATURE_UNAVAILABLE` |
| Null feature | `ML_INELIGIBLE` | `SKIPPED` | `ML_INELIGIBLE_FEATURES_INCOMPLETE` |
| NaN feature | `ML_INELIGIBLE` | `SKIPPED` | `ML_INELIGIBLE_FEATURE_NAN` |
| Infinity feature | `ML_INELIGIBLE` | `SKIPPED` | `ML_INELIGIBLE_FEATURE_INFINITY` |
| Malformed feature | `ML_INELIGIBLE` | `SKIPPED` | `ML_INELIGIBLE_FEATURE_MALFORMED` |
| Stale feature | `ML_INELIGIBLE` | `SKIPPED` | `ML_INELIGIBLE_FEATURE_STALE` |
| Feature schema mismatch / missing | `ML_INELIGIBLE` | `SKIPPED` | `ML_INELIGIBLE_FEATURE_SCHEMA_MISMATCH` |
| Feature integrity omitted / null | `ML_INELIGIBLE` | `SKIPPED` | `ML_INELIGIBLE_FEATURE_INTEGRITY_UNASSERTED` |
| Model version incompatible / unknown | `ML_INELIGIBLE` | `SKIPPED` | `ML_INELIGIBLE_MODEL_VERSION_INCOMPATIBLE` |

Missing values are never fabricated. NaN/Infinity/malformed/stale/schema-incompatible features cannot silently become eligible.

Callers represent conditions the boolean/numeric manifest cannot encode with `featureIntegrity` (`VALID` \| `MISSING` \| `NULL` \| `NAN` \| `INFINITY` \| `MALFORMED` \| `STALE` \| `SCHEMA_MISMATCH`). Absence or `null` is **not** treated as `VALID` and cannot become eligible even when typed feature fields are populated. `VALID` is the only positive integrity state.

## Inference failure taxonomy

| Condition | Eligibility | Outcome | Reason code | Fallback |
|-----------|-------------|---------|-------------|----------|
| Model unavailable | `ML_ELIGIBLE` | `FAILED_SAFE` | `ML_FAILED_SAFE_MODEL_UNAVAILABLE` | `DETERMINISTIC_RULES` |
| Timeout | `ML_ELIGIBLE` | `FAILED_SAFE` | `ML_FAILED_SAFE_INFERENCE_TIMEOUT` | `DETERMINISTIC_RULES` |
| Exception | `ML_ELIGIBLE` | `FAILED_SAFE` | `ML_FAILED_SAFE_INFERENCE_ERROR` | `DETERMINISTIC_RULES` |
| Malformed / missing identity / unexpected type / out-of-range / NaN / Infinity / corrupt metadata | `ML_ELIGIBLE` | `FAILED_SAFE` | `ML_FAILED_SAFE_INVALID_OUTPUT` | `DETERMINISTIC_RULES` |
| Valid but low confidence | `ML_ELIGIBLE` | `SKIPPED` | `ML_LOW_MODEL_CONFIDENCE` | `OBSERVE` |

Timeout is adapter-signaled (`MlInferenceTimeoutError`). `MlDecisionService` does **not** use `Promise.race`, so there is no losing inference promise and no vendor cancellation API. The returned `MLDecision` is a snapshot; a later adapter settlement cannot overwrite it or change Action Policy / execution eligibility.

## Safe-degradation taxonomy

| Fallback | When |
|----------|------|
| `DETERMINISTIC_RULES` | Ineligible history/persistence/schema/stale/missing feature, or any `FAILED_SAFE` |
| `OBSERVE` | Immature evidence or low model confidence |
| `REJECT` | Invalid evidence or NaN/Infinity/malformed features |
| `NONE` | Valid `EXECUTED` contribution only |

Deterministic fallback continues through existing readiness / Action Policy / approval paths. It never approves, executes, or invokes AWS.

## Non-authority boundary

ML cannot:

- set `READY` or `APPROVED`
- change `approvalRequired`
- invoke `ExecutionApiService` or `ExecutionOrchestrator`
- invoke AWS adapters or rollback
- bypass MFA or tenant authorization
- turn failed verification into success

Sprint 4 governance-regression qualification remains the contradiction/release-blocking layer (`claimsMlAuthority`, `mlAuthorizedRollback`). Structural import assertions cover the ML/execution dependency boundary.

## Model provenance

Sprint 4 Engineer 1 already made structured `modelId` durable. Engineer 3 proves reconstructable:

| Field | Durable location |
|-------|------------------|
| `evaluationId` | ActionLog `sourceRecordId` |
| `modelId` | ActionLog structured `modelId` |
| `modelVersion` | ActionLog `sourceRecordVersion` on outcome events |
| `eligibilityPolicyVersion` | ActionLog `sourceRecordVersion` on eligibility events |
| `featureSchemaVersion` | ActionLog structured `featureSchemaVersion` (new optional field) |
| inference timestamp | ActionLog `occurredAt` on outcome events |
| structured outcome / fallback / reason codes | ActionLog `eventType` + `reasonCodes` |

## Feature schema provenance decision

Engineer 1 treated `featureSchemaVersion` as non-material operational data. Sprint 4 Engineer 3 requires it for production ML reproducibility.

**Decision:** persist `featureSchemaVersion?: string` as optional structured ActionLog / `MlProvenanceSummary` metadata.

- Do **not** encode it inside `reasonCodes`.
- Do **not** put it in an unbounded metadata blob.
- Do **not** change logical ActionLog identity.
- Require a non-empty valid value when the field is present.
- Legacy ActionLog rows without the field remain reconstructable (`featureSchemaVersion` omitted).

`MLDecision.featureSchemaVersion` was already optional on the Sprint 3 contract; ActionLog and reconstruction now round-trip it.

## Confidence interaction

| Vector | Authoritative contract |
|--------|------------------------|
| ML high + governance fail | Governance regression `BLOCKED` |
| ML high + `NOT_READY` | Action Policy `BLOCKED` / `NOT_READY` |
| ML high + approval required | Action Policy `REQUIRED` |
| ML low + deterministic fallback | ML `OBSERVE`; commercial confidence unchanged |
| ML failure + HIGH deterministic confidence | ML `FAILED_SAFE`; approval still `REQUIRED` |

```text
ML confidence != platform confidence
ML confidence != READY
ML confidence != APPROVED
ML confidence != execution eligibility
```

Commercial confidence / readiness / Action Policy remain authoritative.

## No-ML equivalence

Canonical comparison vectors:

- ML available
- ML unavailable
- required feature missing
- inference failing

Where deterministic inputs are equivalent, repeated evaluation produces equivalent fallback decisions and stable reason codes. No-ML remains a supported production state (`UnavailableMlInferenceAdapter` is the safe default factory mode).

## Adversarial output handling

All inference output is untrusted (`raw?: unknown`). Validation rejects:

- wrong primitive types
- arrays where objects are expected
- objects where scalars are expected
- prototype-like keys (`__proto__`, `constructor`, `prototype`)
- oversized / empty identity strings
- negative / huge / NaN / Infinity confidence
- nested non-finite or forbidden contribution metadata
- unexpected model identity or version
- missing mandatory fields

Extra unknown fields are not copied into `validatedOutput`. Invalid output cannot affect readiness, approval, execution, rollback, tenant scope, or secret persistence. Trusted request-scope provenance is retained on `FAILED_SAFE`.

## Golden vectors

Reusable fixtures live in `backend/tests/fixtures/sprint-4-ml/`. Required IDs:

```text
ML_PRODUCTION_ELIGIBLE_VALID
ML_INSUFFICIENT_HISTORY
ML_IMMATURE
ML_FEATURE_MISSING
ML_FEATURE_SCHEMA_MISMATCH
ML_MODEL_UNAVAILABLE
ML_MODEL_VERSION_INCOMPATIBLE
ML_TIMEOUT
ML_INFERENCE_EXCEPTION
ML_CORRUPT_OUTPUT
ML_LOW_CONFIDENCE
ML_HIGH_CONFIDENCE_NON_AUTHORITY
ML_NO_ML_DETERMINISTIC_EQUIVALENCE
```

Additional vectors: NaN, Infinity, null, stale feature, missing modelId/modelVersion, malformed metadata, insufficient persistence.

Vectors assert structured outcomes and stable reason codes, not only thrown exceptions.

## Known limitations

- Live SageMaker / vendor model runtime remains **DEFERRED**.
- `MlDecisionService` is still not wired into an HTTP orchestration route.
- Feature-integrity signals are explicit caller assertions; the platform does not invent missing telemetry.
- ActionLog `featureSchemaVersion` is optional for legacy compatibility; new ML emits should populate it when known.

## Future live-model-provider handoff

A future approved production adapter may implement `MlInferenceAdapter` without changing:

- eligibility policy authority
- Action Policy approval semantics
- execution / rollback ownership
- tenant / RBAC / MFA gates

Until that adapter exists, `createMlInferenceAdapter()` defaults to `UnavailableMlInferenceAdapter`. Qualification of a snapshot with `liveExternalProviderIntegrated: true` returns **DEFERRED**. Do not add a vendor SDK solely to make qualification look complete.

## Validation

```bash
cd backend
npm run test:sprint4-ml-production-qualification
```
