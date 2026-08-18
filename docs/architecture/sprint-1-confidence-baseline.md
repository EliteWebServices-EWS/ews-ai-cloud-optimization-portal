# Sprint 1 - Confidence Baseline

**Status:** Baseline complete; commercial calculation frozen

**Owner:** Andrew

**Purpose:** Document the existing commercial confidence model before any convergence or ML work.

## Scope

This document records the current EWS workflow confidence behavior exactly as implemented in `backend/engines/confidence/`. It does not introduce research-derived formulas, change factor weights, change thresholds, or alter governance behavior.

Confidence is a weighted **0–100** assessment of trust in an optimization decision. It is separate from governance readiness and must not authorize production execution by itself.

Sprint 1 preserves the commercial **0–100** model. It does **not** replace it with a research **[0,1]** formulation. That comparison belongs to Sprint 2 confidence convergence work.

EC2 Cost rule confidence (`backend/cloud-intelligence/ec2-cost/ec2-cost-confidence.ts`) is a separate domain-specific fractional model and is **not** part of this workflow baseline.

Sprint 2 evidence-aware qualification (`confidence-evidence-aware-v2`) is documented separately in `docs/architecture/adr-int-04-confidence-scoring-formulation.md`. Sprint 1 raw commercial arithmetic facts in this document remain frozen historical baseline references.

### Sprint 2 compatibility (confidence-evidence-aware-v2)

| Dimension | Status |
| --- | --- |
| Arithmetic compatibility | **PRESERVED** |
| Schema compatibility | **PRESERVED** |
| Status/behavior compatibility | **INTENTIONALLY CHANGED** in confidence-evidence-aware-v2 |
| Audit compatibility | **ENHANCED** |

Do not describe v2 as "fully backward compatible." Legacy callers without longitudinal context preserve raw commercial scores but may receive a lower qualified final status than Sprint 1 threshold status alone.

See also: `docs/architecture/sprint-2-confidence-engineer-handoff.md`.

## Default configuration

| Setting | Default |
| --- | ---: |
| Formula version | `commercial-weighted-v1` |
| HIGH threshold | 80 |
| MEDIUM threshold | 50 |
| Minimum metrics datapoints | 7 |
| Minimum utilization-history entries | 5 |
| Minimum observation window | 7 days |
| Maximum CPU coefficient of variation | 0.35 |

Scores below 50 are classified as LOW by threshold rules.

## Scoring factors

| Factor | Weight | Current behavior |
| --- | ---: | --- |
| workload-stability | 25 | Scores CPU and memory variability using coefficient of variation. |
| historical-consistency | 20 | Scores utilization-history count against the minimum of 5 entries. |
| recommendation-persistence | 15 | Scores 100 when current evidence contains a provider recommendation for the resource; otherwise 20. This is **not** longitudinal `NEW` / `STABLE` / `CHANGED` / `MISSING_PREVIOUS` intelligence. |
| metrics-quality | 20 | Scores metrics datapoints against the minimum of 7. |
| evidence-completeness | 10 | Scores 100 when validation passes; otherwise deducts 25 points per validation error, to a minimum of zero. |
| telemetry-continuity | 10 | Scores the observation window against the minimum of 7 days using `min(observationWindowDays / 7, 1) × 100`. |

The total **commercial score** is the weighted average of these six factor scores, rounded to the nearest whole number.

## Classification

| Commercial score | Status |
| --- | --- |
| 80–100 | HIGH |
| 50–79 | MEDIUM |
| 0–49 | LOW |

## Result contract

`ConfidenceResult` preserves backward-compatible fields:

| Field | Meaning |
| --- | --- |
| `score` | Frozen commercial weighted score |
| `status` | Threshold classification derived from score |
| `level` | Legacy lowercase mirror of `status` |
| `factors[]` | Factor name, score, weight, detail |
| `reason` | Explanation of the resulting confidence assessment |
| `formulaVersion` | Identifier for the frozen commercial scoring formula (`commercial-weighted-v1`) |

Existing consumers continue to use `score`, `status`, `level`, `factors`, and `reason` without requiring changes. Additive fields are optional for older frontend types.

## Commercial calculation flow

```
existing commercial calculation
        |
        v
score (frozen commercial score)
        |
        v
status (threshold classification from score)
        |
        v
factor explanations
        |
        v
reason (factor-aware summary for HIGH results)
        |
        v
level
formulaVersion
```

Sprint 1 does **not** apply a separate final status qualification gate at the scoring layer.

## Evidence-safety behavior

Sprint 1 requirement:

> Materially incomplete evidence cannot silently produce unexplained HIGH confidence.

### Existing fail-closed boundaries (production workflow)

| Boundary | Behavior | Source |
| --- | --- | --- |
| Missing evidence | Confidence engine error; no score | `confidence.engine.ts` |
| `evidenceStatus === INCOMPLETE` | Confidence engine error; no score | `confidence.engine.ts` |
| Invalid provider bundle (`validation.valid === false`) | Evidence engine error (`EVIDENCE_INCOMPLETE`); confidence stage not reached | `evidence.engine.ts`, `evidence.validator.ts` |

In the normal workflow path, confidence is only calculated after evidence collection succeeds with `validation.valid === true` and `evidenceStatus === COMPLETE`.

### Scoring-layer explanation (Sprint 1)

When the commercial threshold status is **HIGH** but one or more factor scores are below 100, the summary `reason` names those factor limitations instead of using the generic stable-workload message alone.

This uses existing factor outputs only. It does **not**:

- change factor weights
- change thresholds
- cap the commercial score
- introduce new evidence states
- treat `validation.valid === false` as a blanket HIGH-status gate inside `calculateConfidence`

### Why no scoring-layer status qualification gate in Sprint 1

`validation.valid` in `EvidenceValidationResult` means `errors.length === 0` from merged structural validation checks (`evidence.validator.ts`). The evidence engine maps `validation.valid === false` to `EVIDENCE_INCOMPLETE`, but that mapping is an engine-boundary decision rather than a universal semantic guarantee for every caller of `calculateConfidence`.

Because the repository does not expose a single authoritative "materially incomplete evidence" signal that safely supports a blanket HIGH-to-non-HIGH qualification inside the scoring function without inventing new business semantics, Sprint 1 stops at:

1. existing engine fail-closed behavior
2. factor-aware HIGH explanations

A separate evidence-qualified final status remains a Sprint 2 convergence input.

## Missing-data behavior

### Engine boundary

`ConfidenceEngine` fails closed when:

- evidence is missing
- `evidenceStatus === INCOMPLETE`

No fallback score is produced in those cases.

### Scoring-layer behavior

| Condition | Effect |
| --- | --- |
| Missing provider recommendation | `recommendation-persistence` factor = 20; commercial score may still be HIGH; reason names the factor limitation |
| Invalid validation (`validation.valid === false`) | `evidence-completeness` factor reduced; commercial score may still be HIGH in direct scoring calls; production workflow normally prevents this path |
| Low metrics datapoints | proportional `metrics-quality` reduction |
| Short observation window | proportional `telemetry-continuity` reduction |
| Few history entries | proportional `historical-consistency` reduction |

Missing recommendation, missing metrics, and invalid evidence are **not** automatically equivalent to LOW confidence.

## Factor-level explanation

Every result includes:

| Field | Meaning |
| --- | --- |
| `factors[].name` | Factor identifier |
| `factors[].score` | Factor score (0–100) |
| `factors[].weight` | Factor weight |
| `factors[].detail` | Human-readable factor reason |
| `score` | Frozen commercial weighted score |
| `status` | Threshold classification derived from score |
| `reason` | Explanation of the resulting confidence assessment, factor-aware for HIGH |
| `formulaVersion` | Identifier for the frozen commercial scoring formula |

## Deterministic behavior

Given identical evidence, validation, resourceId, and configuration:

```
same input + same configuration = same result
```

Repeated execution returns equivalent score, statuses, factors, reason, and formula version.

## Golden decision vector inventory

Implemented in `backend/tests/unit/confidence.scoring.test.ts` and `backend/tests/unit/confidence.engine.test.ts`.

| Vector | Commercial score | Status | Notes |
| --- | ---: | --- | --- |
| Complete evidence | 100 | HIGH | All factors strong |
| Missing recommendation | 88 | HIGH | Provider hint absent; reason names factor limitation |
| One validation error | 98 | HIGH | Reason names evidence-completeness limitation |
| HIGH boundary | 80 | HIGH | Reason names completeness and telemetry limitations |
| Just below HIGH | 79 | MEDIUM | |
| MEDIUM boundary | 50 | MEDIUM | |
| Just below MEDIUM | 49 | LOW | |
| Incomplete telemetry | 93 | HIGH | Named telemetry factor explanation |
| Recommendation present vs absent | 100 / 88 | HIGH / HIGH | Current commercial semantics only |
| Repeated execution | unchanged | unchanged | Determinism regression |
| Factor explanation | all six factors populated | | |
| Formula version | `commercial-weighted-v1` | | |
| Missing evidence | engine error | | No score |
| Incomplete evidence status | engine error | | No score |
| HIGH reason not silent | 88 | HIGH | Reason references factor limitations |

### Longitudinal persistence boundary

Sprint 1 workflow confidence does **not** integrate longitudinal persistence states:

- `NEW`
- `STABLE`
- `CHANGED`
- `MISSING_PREVIOUS`

Backlog items referring to new/changed/persistent recommendation are covered only to the extent of the current provider-hint `recommendation-persistence` factor. Longitudinal persistence-state integration is a Sprint 2 convergence concern.

## Current limitations and Sprint 2 inputs

- `recommendation-persistence` is a current provider-hint check, not longitudinal persistence intelligence.
- Confidence does not consume a platform-wide evidence-maturity result.
- Invalid evidence can still produce a high **commercial** score in direct scoring calls; production workflow normally blocks invalid bundles earlier.
- Telemetry incompleteness alone does not change threshold status in Sprint 1; it is reflected in factor scores and HIGH reasons.
- Confidence remains advisory and must not bypass governance, approval, or post-action verification.
- Sprint 2 may introduce evidence-qualified final status semantics with explicit architectural approval.

## Baseline acceptance criteria

- Given identical inputs and configuration, the score and status are deterministic.
- Each total score can be decomposed into its six factors.
- Boundary behavior at 80, 79, 50, and 49 is covered by tests.
- Commercial baseline outputs remain: 100, 88, 98, 80, 79, 50, 49.
- HIGH results with factor limitations are explained through `reason` and `factors`.
- Formula version is exposed on every result.
- No factor weights, thresholds, or commercial score formula changes as part of this baseline.
