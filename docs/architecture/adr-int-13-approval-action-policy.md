# ADR-INT-13: Enterprise Action Governance — Approval & Controlled Action Policy

## Status

Accepted — Sprint 3 Engineer 2

## Context

Sprint 2 produces authoritative decision readiness (`READY` / `NOT_READY`). Sprint 3 requires a deterministic policy boundary between readiness, optional ML summary input, human approval, and the existing execution foundation (plans, MFA, authorization, orchestrator, ActionLog).

**ADR numbering note (Enterprise Handbook reservations):**

| Identifier | Reserved topic |
|------------|----------------|
| `ADR-INT-06` | Longitudinal ActionLog and decision reconstruction |
| `ADR-INT-07` | Cost evidence taxonomy (`estimated` / `observed` / `verified`) |
| `ADR-INT-08` | Verification and rollback advisory state machine |
| `ADR-INT-09` | Decision data retention and evidence lineage |
| `ADR-INT-10` | IP-controlled proprietary-method process |
| `ADR-INT-11` | Service-plugin contract |
| `ADR-INT-12` | Controlled autonomy policy |

This Engineer 2 decision uses **`ADR-INT-13`**, the next unused intelligence ADR identifier in the handbook registry.

Critical invariants:

```text
READY != APPROVED
APPROVED != EXECUTED
ML != AUTHORITY
SIMULATION != PRODUCTION ACTION
```

## Decision

1. Introduce a pure, versioned action policy module (`action-policy-v1`) that **consumes** readiness and an optional ML summary boundary — no readiness recomputation, no ML inference.
2. **Extend** `ExecutionApiService` with optional `policyContext` on plan create, policy-derived `approvalRequired`, metadata snapshots, production/simulation eligibility gates, and optional ActionLog emission — do not replace execution repositories or lifecycle.
3. **Reuse** existing approval persistence (`ExecutionPlanRecord`, `ExecutionHistoryRecord`) and privileged MFA/authorization.
4. **Defer** override governance (`APPROVAL_OVERRIDDEN`) until a safe override path exists in the execution foundation.
5. **Fail closed** on production execution when action-policy provenance is missing on the plan.

## Consequences

- Policy-bound plans carry durable provenance in plan metadata and ActionLog.
- Legacy plans may still be created without `policyContext`, but production execution requires a stored policy snapshot.
- Engineer 3 replaces `MlDecisionSummary` with authoritative ML types when ready.
- Engineer 4 continues to own verification ActionLog events (handoff to reserved `ADR-INT-08` scope).

## Alternatives considered

- Replacing ExecutionPlan with a new governance aggregate — rejected (violates extend-not-replace guardrails).
- Embedding policy rules in HTTP routes — rejected (needs deterministic unit tests and reuse at service layer).
- ML-driven auto-approval — rejected (ML != AUTHORITY).
- Silently grandfathering production execution without policy provenance — rejected (readiness/policy bypass).
- Using `ADR-INT-08` for this decision — rejected (handbook reserves INT-08 for verification/rollback advisory state machine).
