> **Note:** This is an alternative implementation of the Sprint 4 governance regression / unsafe-state release blocking task, built independently of and in parallel with `governance-regression/` (merged in #282/#283, authored by Obianuju Florence). It lives under `governance-regression-eng2/` specifically to avoid overwriting or conflicting with that merged work, and is submitted here for comparison rather than as a replacement. See the PR description for context.

# Sprint 4 Governance Regression & Unsafe-State Release Blocking — Engineer 2

Branch: `feature/sprint-4-governance-regression-eng2alt`
Related: `docs/architecture/adr-int-14-eng2-alt-governance-regression-safety-gate.md`,
`docs/architecture/sprint-4-governance-audit-inventory.md`,
`docs/validation/sprint-4-governance-regression-matrix-report.md`

## Scope

This sprint proves that the Sprint 1-3 intelligence pipeline (evidence
maturity -> governance convergence -> confidence -> decision readiness ->
ML decision -> action policy -> approval -> execution -> post-action
verification) cannot reach an unsafe production terminal state through any
combination of missing or contradictory evidence, and closes the one real
gap identified in the Sprint 4 provenance inventory: rollback authorization
had no independent governance boundary.

It does **not** re-implement any Sprint 1-3 engine. `governance-regression-eng2/`
and `rollback-authorization/` are new modules; nothing in
`decision-readiness/`, `governance-convergence/`, `evidence-maturity/`,
`ml-decision/`, `action-policy/`, or `post-action-verification/` was
changed.

## Files added

### Production

- `backend/governance-regression-eng2/` — `types.ts`, `reason-codes.ts`,
  `model-version.ts`, `invariants.ts` (Task 2), `contradiction-detector.ts`
  (Task 4), `safety-gate.ts` (Task 8), `index.ts`
- `backend/rollback-authorization/` — `types.ts`, `reason-codes.ts`,
  `model-version.ts`, `evaluate-rollback-authorization.ts` (Task 5),
  `index.ts`

### Tests & fixtures

- `backend/tests/fixtures/sprint-4-governance-regression-eng2-alt/regression-matrix-fixtures.ts`
  — baseline builder + the 16 named Task 3 scenarios
- `backend/tests/unit/governance-regression-invariants.test.ts` (Task 2)
- `backend/tests/unit/governance-regression-contradiction-detection.test.ts`
  (Task 4)
- `backend/tests/integration/sprint-4-governance-regression-matrix.test.ts`
  (Task 3 + Task 8)
- `backend/tests/unit/rollback-authorization.test.ts` (Task 5)
- `backend/tests/security/sprint-4-governance-security-regression.test.ts`
  (Task 7)

### Documentation

- `docs/architecture/adr-int-14-eng2-alt-governance-regression-safety-gate.md`
- `docs/architecture/sprint-4-governance-audit-inventory.md` (Task 1)
- `docs/architecture/sprint-4-governance-regression-eng2-alt.md` (this file, Task 9)
- `docs/validation/sprint-4-governance-regression-matrix-report.md`

## Task 1 — governance contract audit

See `docs/architecture/sprint-4-governance-audit-inventory.md` for the full
inventory. Summary: two readiness vocabularies and two governance
vocabularies exist in the codebase (Sprint 2 canonical vs. legacy
`engines/governance/`), and they are deliberately kept as separate typed
fields rather than merged — `governance-regression-eng2` reads both where
relevant but computes neither.

## Task 2 — canonical safety invariants

`backend/governance-regression-eng2/invariants.ts` implements all ten invariants
from the brief as independent pure predicate functions over a
`DecisionLifecycleSnapshot`:

| Invariant | Function | Reason code |
|---|---|---|
| IMMATURE ≠ READY | `checkImmatureNotReady` | `GOVREG_INVARIANT_IMMATURE_NOT_READY` |
| NOT_READY cannot execute | `checkNotReadyCannotExecute` | `GOVREG_INVARIANT_NOT_READY_CANNOT_EXECUTE` |
| governance FAIL cannot be overridden by ML | `checkGovernanceFailNotOverridableByMl` | `GOVREG_INVARIANT_GOVERNANCE_FAIL_NOT_OVERRIDABLE_BY_ML` |
| HIGH confidence ≠ APPROVED | `checkHighConfidenceNotApproval` | `GOVREG_INVARIANT_HIGH_CONFIDENCE_NOT_APPROVAL` |
| ML EXECUTED ≠ AUTHORITY | `checkMlExecutedNotAuthority` | `GOVREG_INVARIANT_ML_EXECUTED_NOT_AUTHORITY` |
| ML FAILED_SAFE cannot weaken governance | `checkMlFailedSafeCannotWeakenGovernance` | `GOVREG_INVARIANT_ML_FAILED_SAFE_MUST_NOT_WEAKEN_GOVERNANCE` |
| APPROVAL REQUIRED + missing approval cannot execute | `checkApprovalRequiredMissingCannotExecute` | `GOVREG_INVARIANT_APPROVAL_REQUIRED_MISSING_CANNOT_EXECUTE` |
| API execution success ≠ optimization success | `checkApiSuccessNotOptimizationSuccess` | `GOVREG_INVARIANT_API_SUCCESS_NOT_OPTIMIZATION_SUCCESS` |
| INSUFFICIENT_EVIDENCE ≠ successful verification | `checkInsufficientEvidenceNotSuccessfulVerification` | `GOVREG_INVARIANT_INSUFFICIENT_EVIDENCE_NOT_SUCCESSFUL_VERIFICATION` |
| ROLLBACK_CANDIDATE ≠ rollback authorization | `checkRollbackCandidateNotAuthorization` | `GOVREG_INVARIANT_ROLLBACK_CANDIDATE_NOT_AUTHORIZATION` |

Two of these deliberately check for evidence that a *lower-level* engine
already enforced the rule, rather than re-deriving it: the ML invariants
look for `action-policy`'s own `ACTION_POLICY_ML_EXECUTED_NON_AUTHORITY`
and `ACTION_POLICY_ML_FAILED_SAFE_APPROVAL_UNCHANGED` reason codes. This
means a future refactor of `action-policy/evaluate-action-policy.ts` that
accidentally drops one of those reason codes fails Sprint 4 regression even
if the refactor "looks" correct in isolation.

## Task 3 — governance regression matrix

`tests/fixtures/sprint-4-governance-regression/regression-matrix-fixtures.ts`
encodes all 16 required scenarios as deviations from a single
`buildSafeBaselineSnapshot()`. The integration test
(`tests/integration/sprint-4-governance-regression-matrix.test.ts`) runs
every scenario through `evaluateReleaseSafetyGate` and asserts the expected
verdict:

| # | Scenario | Verdict | Why |
|---|---|---|---|
| 1 | recommendation without mature evidence | SAFE | Correctly blocked upstream (NOT_READY, NOT_ELIGIBLE) — nothing unsafe reached execution |
| 2 | mature evidence + governance failure | SAFE | Governance MISSING correctly held NOT_READY/NOT_ELIGIBLE |
| 3 | governance pass + insufficient confidence | SAFE | MEDIUM confidence correctly held NOT_READY/NOT_ELIGIBLE |
| 4 | NOT_READY + high ML confidence | **BLOCKED** | Execution eligibility flipped to ELIGIBLE despite NOT_READY readiness — invariant violation even though the ML reason code was correctly recorded |
| 5 | ML unavailable | SAFE | Deterministic path unaffected by ML absence |
| 6 | ML corrupt output | SAFE | Resolves to FAILED_SAFE with the unchanged-approval marker present |
| 7 | pricing unavailable | INSUFFICIENT_EVIDENCE | Readiness/policy stages report unavailable — gate refuses to certify SAFE on partial data |
| 8 | telemetry unavailable | INSUFFICIENT_EVIDENCE | Same shape as pricing unavailability |
| 9 | missing approval | SAFE | REQUIRED + PENDING correctly held NOT_ELIGIBLE |
| 10 | rejected approval | SAFE | REQUIRED + REJECTED correctly held NOT_ELIGIBLE |
| 11 | stale approval | SAFE | REQUIRED + STALE correctly held NOT_ELIGIBLE |
| 12 | execution provider failure | SAFE | A failed API call makes no success claim, so no optimization-success invariant is triggered |
| 13 | verification insufficient | SAFE | INSUFFICIENT_EVIDENCE is an honest, correctly-reported state, not miscategorized as resolved |
| 14 | post-action deterioration | SAFE | DEGRADED correctly reported, not miscategorized |
| 15 | rollback candidate without authorization | SAFE | Candidate flagged, evidence sufficient, but correctly **not** authorized — this is the invariant holding, not failing |
| 16 | cross-tenant decision input | **BLOCKED** | Foreign tenant/account scope detected in the decision's input records |

Two additional properties are asserted across the whole matrix: the gate is
**deterministic** (running the same scenario twice yields identical
results) and every `SAFE` verdict has zero recorded invariant violations or
contradictions (no "SAFE despite an unsafe finding").

## Task 4 — contradiction semantics

`contradiction-detector.ts` reports impossible/unsafe *combinations of
already-recorded state* with stable, append-only reason codes
(`GOVREG_CONTRADICTION_*`). It never rewrites, deletes, or "fixes" a
contradictory historical record — a contradiction found in a stored
decision is a signal for operator/provenance review, not something this
module resolves. The five required combinations plus cross-tenant input
scope are covered; see `tests/unit/governance-regression-contradiction-detection.test.ts`.

## Unsafe terminal states

A "terminal state" here means any state a decision or execution can be left
in once no further stage will run against it. The invariants and
contradictions above are what keep every terminal state safe:

- An execution never completes `ELIGIBLE` while readiness is `NOT_READY` or
  governance failed.
- An `APPROVED` status is never present without an attributable human
  actor.
- A `ROLLBACK_CANDIDATE` verification outcome never becomes an authorized
  rollback without going through `rollback-authorization/` (see below).
- An `INSUFFICIENT_EVIDENCE` verification outcome is never read downstream
  as a successful/resolved terminal state.
- A cross-tenant/cross-account input never contributes to a decision's
  terminal state.

## Task 5 — rollback authorization boundary

`backend/rollback-authorization/evaluate-rollback-authorization.ts` is the
required independently-governed boundary. It denies, in order:

1. cross-tenant/cross-account requests (`DENIED_CROSS_TENANT`),
2. requests sourced from `ML` (`DENIED_ML_CANNOT_AUTHORIZE`) —
   **ML cannot authorize rollback**,
3. requests sourced from `VERIFICATION_ENGINE`
   (`DENIED_VERIFICATION_CANNOT_INVOKE_DIRECTLY`) — **verification cannot
   invoke rollback directly**,
4. rollback on an execution already rolled back
   (`DENIED_ALREADY_ROLLED_BACK`),
5. rollback on an execution not in a rollback-eligible terminal state
   (`DENIED_EXECUTION_NOT_ROLLBACK_ELIGIBLE_STATE`),
6. a verification outcome that isn't `ROLLBACK_CANDIDATE`
   (`DENIED_NOT_ROLLBACK_CANDIDATE`) — **ROLLBACK_CANDIDATE alone cannot
   execute rollback**, this is the entry condition, not the authorization,
7. insufficient rollback evidence (`DENIED_EVIDENCE_INSUFFICIENT`),
8. an unauthorized actor, by delegating to
   `action-policy/evaluateActionPolicyActorGate`
   (`DENIED_ACTOR_UNAUTHORIZED`) — **privileged rollback preserves RBAC**,
9. a missing privileged-MFA claim, through the same actor gate
   (`DENIED_MFA_REQUIRED`) — **privileged rollback preserves MFA**.

Only a `HUMAN_ACTOR` request that clears every gate above is authorized,
and the result always carries `authorizedByActorId` +
`authorizedAt` — **rollback authorization is attributable**. See
`tests/unit/rollback-authorization.test.ts`.

## Task 6 — legacy fail-closed audit

Two execution surfaces exist in the codebase:

1. **`execution/execution-orchestrator.ts` via `ExecutionApiService`** — the
   real AWS-mutating path, gated by Sprint 3 `action-policy`. It was
   already fail-closed before this sprint:
   `action-policy/execution-eligibility-gate.ts`
   `assertProductionExecutionEligible` throws `ACTION_POLICY_MISSING` if a
   plan has no policy snapshot, and `ACTION_POLICY_NOT_ELIGIBLE` if
   eligibility isn't `ELIGIBLE`. No change was needed or made.
2. **`orchestrator/workflow.orchestrator.ts` (legacy demo/simulation
   workflow, exposed via `api/routes/index.ts` `executeWorkflow`)** — uses
   `ExecutionSimulator`, whose own source doc-comment states: "Mock
   execution layer — simulates applying an optimization without touching
   AWS." It has no code path to a real AWS mutation regardless of what its
   own `GOVERNANCE_STATUS`/`READINESS_STATUS` scoring returns. This path is
   therefore **demonstrably safe by construction** — bypassing Sprint 1-4
   safety provenance is possible for this path only because it can never
   mutate real infrastructure in the first place. No change was made to it;
   changing it would be scope creep against a path that presents no actual
   risk.

No legitimate historical data was altered by this audit or by any code in
this sprint.

## Task 7 — security regression

`tests/security/sprint-4-governance-security-regression.test.ts` covers:

- Tenant A input cannot contribute to a Tenant B decision (contradiction
  detector) and Tenant A cannot rollback a Tenant B execution (rollback
  authorization cross-tenant check) — the approve/execute/verify tenant
  isolation surfaces are already covered by
  `tests/security/execution-tenant-isolation.test.ts` and
  `tests/security/sprint-3-approval-action-policy-authorization.test.ts`,
  reused rather than duplicated here.
- An unauthorized tenant role (`analyst`) is denied both privileged
  approval and rollback.
- A missing privileged-MFA claim is denied both privileged approval and
  rollback of a privileged production action.
- A fully authorized, MFA-verified tenant owner succeeds at rollback,
  proving the boundary isn't merely deny-everything.

## Task 8 — release-blocking safety gate

`evaluateReleaseSafetyGate` (in `governance-regression-eng2/safety-gate.ts`)
returns exactly one of `SAFE | BLOCKED | INSUFFICIENT_EVIDENCE` with a
`reasonCodes` array and separate `invariantViolations` /
`contradictions` / `missingEvidence` breakdowns. It is a release
qualification result: it is not invoked from the runtime decision path and
sets no readiness/governance/approval/eligibility state anywhere.

## Task 9 — documentation

This file, together with:

- `docs/architecture/sprint-4-governance-audit-inventory.md` (Task 1),
- `docs/architecture/adr-int-14-eng2-alt-governance-regression-safety-gate.md`,
- `docs/validation/sprint-4-governance-regression-matrix-report.md`
  (regression matrix + security regression evidence, test-run output).

## Definition of Done — status

| Item | Status |
|---|---|
| Governance/readiness foundation reused | Done — no computation duplicated; ML boundary checks reuse `action-policy` reason codes; rollback actor gate reuses `evaluateActionPolicyActorGate` |
| No duplicate governance engine | Done — `governance-regression-eng2`/`rollback-authorization`| Done — `governance-regression`/`rollback-authorization` are read-only / boundary-only, not wired into the runtime decision path |
| Unsafe state combinations explicitly tested | Done — 10 invariants + 6 contradictions + 16-scenario matrix |
| ML cannot weaken governance | Done — `checkGovernanceFailNotOverridableByMl`, `checkMlFailedSafeCannotWeakenGovernance`, `DENIED_ML_CANNOT_AUTHORIZE` |
| Approval cannot be bypassed | Done — `checkApprovalRequiredMissingCannotExecute`, contradiction check on REQUIRED+NOT_REQUIRED |
| Rollback authorization remains controlled | Done — `rollback-authorization/` |
| RBAC/MFA/tenant isolation enforced | Done — reused actor gate + Task 7 security regression |
| Regression matrix passes | Done — see validation report |
| Unsafe terminal states release-block | Done — `BLOCKED` verdict on any invariant violation or contradiction |
