# ADR-INT-05: ML Eligibility, Safe Degradation & Deterministic Fallback

## Status

Accepted — Sprint 3 Engineer 3

## Context

Sprint 2 produces authoritative decision readiness (`READY` / `NOT_READY`). Sprint 3 Engineer 2 introduced Action Policy that consumes an optional ML **summary** boundary without invoking inference. Engineer 3 introduces the first production-grade ML decision boundary while preserving ML non-authority.

**Enterprise Handbook reservation:** `ADR-INT-05` is reserved for ML eligibility and safe-degradation contract.

Critical invariants:

```text
ML != AUTHORITY
ML EXECUTED != APPROVED
ML EXECUTED != EXECUTED AWS ACTION
ML FAILED_SAFE != CONTROL BYPASS
READY != APPROVED
APPROVED != EXECUTED
```

No live SageMaker or vendor model runtime exists in this repository today. Sprint 3 delivers the contract, eligibility policy, adapter boundary, validation, fallback, provenance, ActionLog integration, and Action Policy consumer wiring — not production model training or AWS inference infrastructure.

## Decision

1. Introduce authoritative `MLDecision` in `backend/ml-decision/` with eligibility, outcome, fallback, reason codes, model provenance, and validated output fields.
2. Implement deterministic eligibility evaluation that consumes structured Sprint 2 evidence and explicit feature/manifest inputs — **no inference during eligibility**, **no fabricated missing features**.
3. Define vendor-neutral `MlInferenceAdapter` with mock/unavailable adapters only until an approved production runtime exists.
4. Treat model output as untrusted; malformed output becomes `FAILED_SAFE` with `ML_FAILED_SAFE_INVALID_OUTPUT`.
5. Implement safe-degradation state machine and explicit fallback resolver returning only `DETERMINISTIC_RULES`, `OBSERVE`, `REJECT`, or `NONE`.
6. Re-export `MLDecision` from `persistence-intelligence/types.ts` for compatibility; authoritative type lives in `ml-decision/types.ts`.
7. Extend Engineer 1 ActionLog with `ML_ELIGIBILITY_EVALUATED`, `ML_EXECUTED`, `ML_SKIPPED`, `ML_FAILED_SAFE` emitters — ActionLog records authoritative decisions only.
8. Update Engineer 2 `toMlDecisionSummary()` to consume authoritative `MLDecision`; Action Policy remains a pure consumer.

## MLDecision contract

| Field | Purpose |
|-------|---------|
| `eligibility` | `ML_ELIGIBLE` \| `ML_INELIGIBLE` |
| `outcome` | `EXECUTED` \| `SKIPPED` \| `FAILED_SAFE` |
| `modelId` / `modelVersion` | Provenance (nullable when skipped) |
| `reasonCodes` | Stable machine-readable codes |
| `fallback` | `DETERMINISTIC_RULES` \| `OBSERVE` \| `REJECT` \| `NONE` |
| `evaluatedAt` | Eligibility evaluation timestamp |
| `eligibilityPolicyVersion` | Frozen policy version (`ml-eligibility-v1`) |
| `featureSchemaVersion` | Present when inference attempted |
| `inferredAt` | Inference timestamp when applicable |
| `validatedOutput` | Structured validated contribution (never authority) |
| `evaluationId` | Stable idempotency / ActionLog source reference |

Explicitly excluded from `MLDecision`: `approved`, `executed`, AWS mutation authority.

## Eligibility policy

Policy version: `ml-eligibility-v1`

Inputs (explicit — absence is not success):

- decision readiness (`READY` required)
- evidence validation
- evidence maturity (`MATURE` required)
- stable-epoch observation count (minimum policy constant)
- feature completeness manifest
- telemetry quality manifest
- model availability / version compatibility

Missing manifest values fail safely (`ML_INELIGIBLE` or feature-unavailable skip codes). Eligibility does not call inference.

## Safe degradation

| Condition | Eligibility | Outcome | Fallback |
|-----------|-------------|---------|----------|
| Insufficient history | `ML_INELIGIBLE` | `SKIPPED` | `DETERMINISTIC_RULES` |
| Immature evidence | `ML_INELIGIBLE` | `SKIPPED` | `OBSERVE` |
| Invalid evidence | `ML_INELIGIBLE` | `SKIPPED` | `REJECT` |
| Feature unavailable | `ML_INELIGIBLE` | `SKIPPED` | `DETERMINISTIC_RULES` |
| Model unavailable | `ML_ELIGIBLE` | `FAILED_SAFE` | `DETERMINISTIC_RULES` |
| Inference error | `ML_ELIGIBLE` | `FAILED_SAFE` | `DETERMINISTIC_RULES` |
| Corrupt output | `ML_ELIGIBLE` | `FAILED_SAFE` | `DETERMINISTIC_RULES` |
| Low confidence | `ML_ELIGIBLE` | `SKIPPED` | `OBSERVE` |
| Valid inference | `ML_ELIGIBLE` | `EXECUTED` | `NONE` |

`DETERMINISTIC_RULES` means continue through existing deterministic readiness / Action Policy paths — not approve, execute, or invoke AWS.

## Action Policy integration

```text
authoritative MLDecision
        ↓
toMlDecisionSummary(...)
        ↓
evaluateActionPolicy(...)
```

ML influences reason codes only. ML `EXECUTED` adds `ML_EXECUTED_NON_AUTHORITY`; approval remains `REQUIRED` for production infrastructure-changing actions. ML `FAILED_SAFE` adds `ML_FAILED_SAFE_APPROVAL_UNCHANGED`. ML fallback `REJECT` blocks policy eligibility.

## ActionLog integration

`ActionLogEmitter.emitAfterMlDecision()` emits:

1. `ML_ELIGIBILITY_EVALUATED`
2. Outcome event (`ML_EXECUTED` \| `ML_SKIPPED` \| `ML_FAILED_SAFE`)

Preserves tenant/account scope, correlation identity, `evaluationId` as durable source reference, reason codes, and model/version metadata. ActionLog does not recompute ML.

## Security

- No secrets in ML decision/provenance structures (AWS keys, session tokens, Authorization headers, MFA codes).
- Tenant/account scope enforced at ActionLog emission; correlationId cannot override scope.
- ML service and adapters must not import execution orchestrator, AWS mutation adapters, approval lifecycle, or MFA logic.

## Idempotency

`evaluationId` + ActionLog logical event identity prevent duplicate lifecycle events on retry. Inference itself is not assumed idempotent; ambiguous inference retries require explicit future policy.

## Sprint 4 Engineer 3 — production qualification (additive)

Sprint 4 qualifies the Sprint 3 boundary against abnormal, incomplete, and adversarial conditions. It does **not** introduce `MlDecisionServiceV2`, `ActionPolicyV2`, a new governance engine, an ML execution/rollback service, or a vendor SDK.

Hardening that remains inside the existing contracts:

1. Eligibility now fails closed on insufficient persistence, NaN/Infinity/malformed/stale features, missing or mismatched `featureSchemaVersion`, and unknown model compatibility (`compatible === null`).
2. Inference timeouts are distinct (`ML_FAILED_SAFE_INFERENCE_TIMEOUT`) from generic inference exceptions.
3. Output validation treats adapter payloads as `unknown` and rejects prototype-like keys, oversized strings, non-finite contribution numbers, and unexpected model identity.
4. Invalid model output no longer overwrites trusted `modelId` / `modelVersion` / `featureSchemaVersion` on `MLDecision`.
5. `featureSchemaVersion` is durable, structured ActionLog / provenance metadata (optional; non-empty when present). It is **not** encoded in `reasonCodes`. Legacy rows without the field remain reconstructable.
6. `backend/ml-production-qualification/` is a pure read/qualification model over existing `MLDecision` snapshots. It does not make runtime business decisions and is not a substitute for `MlDecisionService`.

Live external model/provider integration remains **DEFERRED**.

## Known limitations / deferred work

- No live SageMaker or production model runtime integrated (**DEFERRED** — Sprint 4 qualification does not add a vendor SDK).
- No HTTP orchestration route wires `MlDecisionService` end-to-end yet (contract + tests prove boundaries).
- Feature manifest assembly from readiness is partial (`buildMlFeatureManifestFromReadiness`); callers must supply explicit unknowns as `null` and optional `featureIntegrity` when numeric/boolean fields cannot represent the condition.
- Engineer 4 verification ActionLog events remain separate (`ADR-INT-08` scope).

## Consequences

- Action Policy can safely consume ML summaries with authoritative provenance.
- No-ML golden path: model unavailable → `FAILED_SAFE` → deterministic Action Policy → approval still required.
- Future production model adoption adds a real `MlInferenceAdapter` implementation without changing Action Policy authority semantics.

## Alternatives considered

- Making ML output auto-approve production actions — rejected (ML != AUTHORITY).
- Embedding SageMaker SDK in Action Policy — rejected (vendor-neutral adapter boundary).
- Fabricating missing feature values from partial evidence — rejected (fail-safe explicit inputs).
- Competing `MLDecision` types in persistence-intelligence — rejected (single authoritative module + compatibility re-export).
