# Sprint 4 Governance Contract Audit (Task 1)

Audit date: 2026-08-21
Branch: `feature/sprint-4-governance-regression`
Auditor: Engineer 2 — Governance Regression & Unsafe-State Release Blocking

## Purpose

Inventory every governance/readiness-adjacent contract produced by Sprint
1-3 before writing a single regression check, so Task 2-4 invariants are
expressed against the **existing** authoritative contracts and this sprint
does not accidentally stand up a second governance or readiness engine.

## Contracts inventoried

| Contract | Module | Canonical states | Authoritative? |
|---|---|---|---|
| `EvidenceMaturity` | `persistence-intelligence/types.ts`, computed by `evidence-maturity/` | `IMMATURE \| PARTIAL \| MATURE` (frozen Sprint 1 union) | Yes — sole source of maturity |
| `GovernanceConvergenceState` | `governance-convergence/types.ts` | `PRESERVED \| IMPROVED \| REPLACED \| MISSING` (frozen Sprint 2 union, `docs/architecture/adr-int-03`) | Yes — sole source of governance convergence for the Sprint 2+ decision pipeline |
| `ConfidenceAssessment` | consumed via `shared/types` `ConfidenceResult` and `decision-readiness/types.ts` `DecisionReadinessConfidenceProvenance` | `status: HIGH \| MEDIUM \| LOW`, `score` | Yes |
| `DecisionReadinessState` | `decision-readiness/types.ts` | `READY \| NOT_READY` | Yes — Sprint 2 canonical readiness. **READY means evidence/decision-readiness only — never approval or execution** (see doc-comment on `Sprint2DecisionReadinessResult`) |
| `MLDecision` | `ml-decision/types.ts` | `eligibility: ML_ELIGIBLE \| ML_INELIGIBLE`; `outcome: EXECUTED \| SKIPPED \| FAILED_SAFE`; `fallback: DETERMINISTIC_RULES \| OBSERVE \| REJECT \| NONE` | Yes, but explicitly **non-authoritative for approval/execution** — see `ml-decision/types.ts` doc-comment: "ML EXECUTED != APPROVED != AWS mutation authority" |
| `ActionPolicyResult` | `action-policy/types.ts` | `approval: REQUIRED \| NOT_REQUIRED \| BLOCKED`; `executionEligibility: ELIGIBLE \| NOT_ELIGIBLE` | Yes — sole source of approval requirement / execution eligibility |
| `Approval` (execution-plan approval) | `repositories/models/execution-persistence-models.ts` via `ExecutionPlanRepository` | `approvalStatus: NOT_REQUIRED \| PENDING \| APPROVED \| REJECTED` (+ stale detection via plan version, `ACTION_POLICY_STALE_PLAN_VERSION`) | Yes |
| `VerificationResult` (legacy comparator) | `shared/types/index.ts` | `status: VerificationStatusValue` (pass/fail/partial style, legacy engine) | Superseded for release-safety purposes by `PostActionVerificationAssessment` below, but still the input the Sprint 3 assessment composes over |
| `PostActionVerificationAssessment` | `post-action-verification/types.ts` | `outcome: HEALTHY \| DEGRADED \| RESOLVED \| INSUFFICIENT_EVIDENCE \| ROLLBACK_CANDIDATE` | Yes — Sprint 3 canonical post-action outcome. Doc-comment: "HEALTHY != RESOLVED. ROLLBACK_CANDIDATE != rollback authorization" |
| `RollbackAssessment` / rollback execution | **Advisory only through Sprint 3** — `ROLLBACK_CANDIDATE` on `PostActionVerificationAssessment`; no durable rollback-authorization record existed before this sprint (`adr-int-08`, `docs/architecture/sprint-4-provenance-inventory.md` "Rollback assessment / execution: MISSING") | n/a until this sprint | This sprint adds `rollback-authorization/` as the authorization boundary — see ADR-INT-14 |
| Legacy governance engine | `engines/governance/`, `shared/constants/index.ts` `GOVERNANCE_STATUS` (`PASS \| FAIL \| WARN`), `READINESS_STATUS` (`READY \| PARTIALLY_READY \| NOT_READY`) | separate, older engine used only by the demo/simulation `WorkflowOrchestrator` (`orchestrator/workflow.orchestrator.ts`) | **Not** the Sprint 2+ decision pipeline. Kept alive for the reporting/demo workflow only — see Task 6 fail-closed audit |

## Overlapping / potentially contradictory states identified

1. **Two "readiness" vocabularies.** `decision-readiness/types.ts`
   (`READY | NOT_READY`) and the legacy `shared/constants`
   `READINESS_STATUS` (`READY | PARTIALLY_READY | NOT_READY`) are distinct
   contracts computed by distinct engines for distinct purposes. They must
   never be merged or treated as interchangeable — `governance-regression`
   consumes only the Sprint 2 `DecisionReadinessState` and treats the legacy
   readiness/governance engine as out of scope (Task 6 covers why that's
   safe).
2. **Two "governance" vocabularies.** `GovernanceConvergenceState`
   (`PRESERVED | IMPROVED | REPLACED | MISSING`) is a *longitudinal
   convergence* classification — whether evidence for a control improved,
   regressed, or went missing over time. The legacy `GOVERNANCE_STATUS`
   (`PASS | WARN | FAIL`) is a *point-in-time compliance* classification
   from the older engine. `governance-regression-eng2/types.ts`
   (`GovernanceSlice`) keeps both as separate optional fields
   (`convergenceState` vs `legacyStatus`) rather than collapsing them into
   one union, and its "governance failed" predicate treats either
   `convergenceState === 'MISSING'` or `legacyStatus === 'FAIL'` as failure
   — this is a read-only OR over two authoritative sources, not a new
   third governance engine.
3. **"HIGH confidence" is not "approved."** Nothing in Sprint 1-3 code
   conflates these, but nothing enforced it as an *invariant* either —
   `decision-readiness` requires confidence HIGH as one of several
   conjunctive conditions for `READY`, and approval is a wholly separate
   Sprint 3 concept (`action-policy` + `ExecutionPlanRepository`
   `approvalStatus`). Task 2 encodes this relationship explicitly as an
   invariant so a future change that accidentally derives approval from
   confidence is caught in regression rather than at incident time.
4. **ML outcome vocabulary is intentionally narrow and already
   non-authoritative by construction.** `action-policy/evaluate-action-policy.ts`
   already never lets `MLDecision.outcome` set `approval` to anything but
   what the deterministic readiness/mode/infra rules would have set
   independently, and always appends a `ML_EXECUTED_NON_AUTHORITY` or
   `ML_FAILED_SAFE_APPROVAL_UNCHANGED` reason code when ML participated.
   This audit treats those two reason codes as the load-bearing evidence
   that the ML boundary held for a given decision, and Task 2's ML
   invariants check for their presence directly rather than
   re-implementing the ML boundary logic.
5. **No prior release-qualification contract existed.** Sprint 1-3 each
   shipped a `sprint-N-*` release-gate/validation test suite
   (e.g. `test:sprint3-verification-release-gate`), but there was no single
   reusable, typed verdict a release pipeline could call. This sprint adds
   exactly one — `governance-regression-eng2/safety-gate.ts` — and nothing else
   is a runtime governance decision-maker.

## No second governance or readiness engine was created

`governance-regression-eng2/` and `rollback-authorization/` are **read-only**
over already-computed stage outputs (`DecisionLifecycleSnapshot`). Neither
module:

- computes `EvidenceMaturity`, `GovernanceConvergenceState`,
  `ConfidenceAssessment`, or `DecisionReadinessState`,
- calls the ML eligibility/decision engines,
- decides `ActionPolicyResult.approval` or `.executionEligibility`, or
- is wired into the runtime decision path (`decision-readiness` ->
  `action-policy` -> `execution`). It is invoked only by release
  qualification tooling and by tests.

`rollback-authorization/evaluate-rollback-authorization.ts` reuses
`action-policy`'s existing `evaluateActionPolicyActorGate` for the
RBAC/MFA actor gate rather than re-implementing authorization logic — see
Task 5 boundary doc in `docs/architecture/sprint-4-governance-regression-eng2-alt.md`.
