# Sprint 1 - Confidence Baseline

**Status:** Baseline only; no production behavior changed

**Owner:** Andrew

**Purpose:** Document the existing commercial confidence model before any convergence or ML work.

## Scope

This document records the current EWS confidence behavior exactly as implemented. It does not introduce research-derived formulas, change thresholds, or alter governance behavior.

Confidence is a weighted 0-100 assessment of trust in an optimization decision. It is separate from governance readiness and must not authorize production execution by itself.

## Default configuration

| Setting | Default |
| --- | ---: |
| HIGH threshold | 80 |
| MEDIUM threshold | 50 |
| Minimum metrics datapoints | 7 |
| Minimum utilization-history entries | 5 |
| Minimum observation window | 7 days |
| Maximum CPU coefficient of variation | 0.35 |

Scores below 50 are classified as LOW.

## Scoring factors

| Factor | Weight | Current behavior |
| --- | ---: | --- |
| workload-stability | 25 | Scores CPU and memory variability using coefficient of variation. |
| historical-consistency | 20 | Scores utilization-history count against the minimum of 5 entries. |
| recommendation-persistence | 15 | Scores 100 when current evidence contains a provider recommendation for the resource; otherwise 20. This is not longitudinal persistence. |
| metrics-quality | 20 | Scores metrics datapoints against the minimum of 7. |
| evidence-completeness | 10 | Scores 100 when validation passes; otherwise deducts 25 points per validation error, to a minimum of zero. |
| telemetry-continuity | 10 | Scores the observation window against the minimum of 7 days. |

The total score is the weighted average of these six factor scores, rounded to the nearest whole number.

## Classification

| Score | Status |
| --- | --- |
| 80-100 | HIGH |
| 50-79 | MEDIUM |
| 0-49 | LOW |

## Current limitations and Sprint 2 inputs

- `recommendation-persistence` is a current provider-hint check, not `NEW`, `STABLE`, `CHANGED`, or `MISSING_PREVIOUS` longitudinal intelligence.
- Confidence can describe factor-level scoring but does not yet consume a platform-wide evidence-maturity result.
- Invalid evidence reduces only the completeness factor; it does not independently block a HIGH score.
- Current thresholds are configuration values and must be tested before they are changed.
- Confidence remains advisory and must not bypass governance, approval, or post-action verification.

## Baseline acceptance criteria

- Given identical inputs and configuration, the score and status are deterministic.
- Each total score can be decomposed into its six factors.
- Boundary behavior at 80, 79, 50, and 49 is covered by tests.
- No algorithm, threshold, or production decision behavior changes as part of this baseline.
