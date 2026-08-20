# Sprint 3 — ML Eligibility, Safe Degradation & Deterministic Fallback

Engineer 3 introduces the authoritative ML decision boundary without making ML authoritative over approval, execution, governance, MFA, or Action Policy.

**ADR:** [`adr-int-05-ml-safe-degradation.md`](./adr-int-05-ml-safe-degradation.md) (`ADR-INT-05`).

## Critical invariants

```text
ML != AUTHORITY
ML EXECUTED != APPROVED
ML EXECUTED != EXECUTED AWS ACTION
ML FAILED_SAFE != CONTROL BYPASS
```

## Module layout

| Component | Location |
|-----------|----------|
| Authoritative contract | `backend/ml-decision/types.ts` |
| Reason codes | `backend/ml-decision/reason-codes.ts` |
| Eligibility policy | `backend/ml-decision/eligibility-policy.ts` |
| Safe degradation / service | `backend/ml-decision/ml-decision-service.ts` |
| Fallback resolver | `backend/ml-decision/fallback-resolver.ts` |
| Output validation | `backend/ml-decision/output-validation.ts` |
| Inference adapter boundary | `backend/ml-decision/adapters/` |
| Adapter factory | `backend/services/ml-inference-adapter-factory.ts` |
| Action Policy consumer | `backend/action-policy/ml-decision-summary.ts` |
| ActionLog emitters | `backend/action-log/action-log-emitter.ts`, `stage-adapters.ts` |
| Golden fixtures | `backend/tests/fixtures/evidence/ml-fixtures.ts` |

Compatibility re-export: `backend/persistence-intelligence/types.ts` → `MLDecision`.

## MLDecision contract summary

| Field | Values |
|-------|--------|
| `eligibility` | `ML_ELIGIBLE` \| `ML_INELIGIBLE` |
| `outcome` | `EXECUTED` \| `SKIPPED` \| `FAILED_SAFE` |
| `fallback` | `DETERMINISTIC_RULES` \| `OBSERVE` \| `REJECT` \| `NONE` |
| `reasonCodes` | Stable codes in `ML_DECISION_REASON` |
| `eligibilityPolicyVersion` | `ml-eligibility-v1` |
| `evaluationId` | Idempotency + ActionLog source reference |

When ML executes successfully, also preserve: `modelId`, `modelVersion`, `featureSchemaVersion`, `inferredAt`, `validatedOutput`.

## Reason code catalogue

See `backend/ml-decision/reason-codes.ts`:

- Eligibility: `ML_ELIGIBLE`, `ML_INELIGIBLE_*` (history, immature, invalid, features, telemetry, model version, readiness)
- Skip: `ML_SKIPPED_FEATURE_UNAVAILABLE`
- Failed safe: `ML_FAILED_SAFE_MODEL_UNAVAILABLE`, `ML_FAILED_SAFE_INFERENCE_ERROR`, `ML_FAILED_SAFE_INVALID_OUTPUT`
- Confidence: `ML_LOW_MODEL_CONFIDENCE`
- Fallback: `ML_FALLBACK_DETERMINISTIC_RULES`, `ML_FALLBACK_OBSERVE`, `ML_FALLBACK_REJECT`

## Eligibility inputs

Eligibility consumes structured upstream evidence — it does not recompute Sprint 2 gates independently or invoke inference.

| Input | Source expectation |
|-------|-------------------|
| Readiness | Sprint 2 `Sprint2DecisionReadinessResult` |
| Validation | Readiness `validation.valid` |
| Maturity | Readiness `maturity.maturity === MATURE` |
| Observation count | Explicit `featureManifest.stableEpochObservationCount` |
| Feature completeness | Explicit `featureManifest.featuresComplete` |
| Telemetry quality | Explicit `featureManifest.telemetryQualityAdequate` or derived from maturity when applicable |
| Model availability | Explicit `modelAvailability` input |

Unknown manifest values must be supplied as `null` — never omitted-as-success.

## Inference adapter boundary

```typescript
interface MlInferenceAdapter {
  infer(request: MlInferenceRequest): Promise<MlInferenceAdapterResult>;
}
```

Implementations in Sprint 3:

- `MockMlInferenceAdapter` — deterministic tests
- `UnavailableMlInferenceAdapter` — safe production default

Adapters must not import execution orchestrator, AWS mutation adapters, approval lifecycle, or MFA logic.

**No live SageMaker integration in this sprint.**

## Safe-degradation truth table

| Scenario | Eligibility | Outcome | Fallback |
|----------|-------------|---------|----------|
| Insufficient observations | INELIGIBLE | SKIPPED | DETERMINISTIC_RULES |
| Immature evidence | INELIGIBLE | SKIPPED | OBSERVE |
| Invalid evidence | INELIGIBLE | SKIPPED | REJECT |
| Feature unavailable | INELIGIBLE | SKIPPED | DETERMINISTIC_RULES |
| Model unavailable | ELIGIBLE | FAILED_SAFE | DETERMINISTIC_RULES |
| Inference error | ELIGIBLE | FAILED_SAFE | DETERMINISTIC_RULES |
| Corrupt / NaN / out-of-range output | ELIGIBLE | FAILED_SAFE | DETERMINISTIC_RULES |
| Low confidence | ELIGIBLE | SKIPPED | OBSERVE |
| Valid inference | ELIGIBLE | EXECUTED | NONE |

## Action Policy integration

```text
MlDecisionService.evaluate(...)
        ↓
MLDecision
        ↓
toMlDecisionSummary(decision)
        ↓
evaluateActionPolicy({ mlDecisionSummary, decisionReadiness, ... })
```

Proofs (tests):

- ML `EXECUTED` cannot set `APPROVED`
- ML `FAILED_SAFE` cannot weaken approval
- ML `INELIGIBLE` + `DETERMINISTIC_RULES` preserves approval requirements
- ML fallback `REJECT` blocks policy eligibility
- ML cannot convert `NOT_READY` → `READY`

## ActionLog integration

`ActionLogEmitter.emitAfterMlDecision()` emits:

1. `ML_ELIGIBILITY_EVALUATED`
2. `ML_EXECUTED` | `ML_SKIPPED` | `ML_FAILED_SAFE`

Scope: tenantId, accountId, resourceId, findingKey, correlationId, decisionId, evaluationId, reasonCodes, occurredAt.

## No-ML golden path (mandatory)

`MATURE` + governance acceptable + HIGH confidence + `READY` + model unavailable:

1. ML eligible (or invocation attempted per policy)
2. `ML_FAILED_SAFE`
3. `DETERMINISTIC_RULES`
4. `toMlDecisionSummary`
5. Action Policy → approval `REQUIRED`
6. Execution `NOT_ELIGIBLE` until approved
7. No AWS execution adapter invoked

Test: `tests/integration/sprint-3-ml-no-ml-golden.test.ts`

## Golden fixture families

| Fixture builder | Expected behavior |
|-----------------|-------------------|
| `buildMlDecisionEvaluateInput()` | ELIGIBLE + EXECUTED |
| `buildMlIneligibleInsufficientHistoryInput()` | INELIGIBLE + SKIPPED |
| `buildMlIneligibleImmatureInput()` | INELIGIBLE + OBSERVE |
| `buildMlSkippedFeatureUnavailableInput()` | feature unavailable skip |
| `buildMlNoMlGoldenPathInput()` | FAILED_SAFE + DETERMINISTIC_RULES |
| Mock adapter `throwOnInfer` | FAILED_SAFE inference error |
| Mock adapter `corruptOutput` | FAILED_SAFE invalid output |
| Mock adapter low confidence | SKIPPED + OBSERVE |

## Tenant / account isolation

- ActionLog emitter rejects tenant/account mismatch with lifecycle context.
- Correlation lifecycle reconstruction is tenant-scoped.
- Model output does not carry trusted tenant authority.

Test: `tests/integration/sprint-3-ml-tenant-isolation.test.ts`

## Failure / idempotency matrix

Covered in:

- `tests/unit/ml-decision-service.test.ts`
- `tests/unit/ml-eligibility-policy.test.ts`
- `tests/unit/ml-output-validation.test.ts`
- `tests/security/sprint-3-ml-non-authority.test.ts`
- `tests/integration/sprint-3-ml-actionlog-integration.test.ts`

No failure path produces autonomous AWS action.

Duplicate `emitAfterMlDecision` with same `evaluationId` is idempotent (second emit `created: false`).

## Test script

```bash
cd backend
npm run test:sprint3-ml-safe-degradation
```

Includes unit, integration, security, Action Policy regression, and evidence fixture catalogue tests.

## Engineer 4 handoff

Verification and rollback advisory ActionLog events remain Engineer 4 scope (`ADR-INT-08`). ML provenance (`evaluationId`, model/version, reason codes) is available for correlation but ML does not authorize verification outcomes.

## Known limitations

- No production model runtime (SageMaker deferred).
- `MlDecisionService` not yet wired into HTTP orchestration route.
- Callers must supply explicit feature manifest fields; partial auto-build from readiness only.
