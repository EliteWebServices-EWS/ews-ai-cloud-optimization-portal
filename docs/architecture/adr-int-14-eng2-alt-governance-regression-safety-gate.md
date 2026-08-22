# ADR-INT-14: Governance Regression Safety Gate & Rollback Authorization Boundary

## Status

Accepted — Sprint 4 Engineer 2

## Context

Sprints 1-3 each shipped an authoritative engine for one stage of the
decision pipeline — `EvidenceMaturity`, `GovernanceConvergence`,
`ConfidenceAssessment`, `DecisionReadiness`, `MLDecision`, `ActionPolicy`,
`Approval`, and `PostActionVerificationAssessment` — plus a per-sprint
release-gate test suite. No sprint verified the *cross-stage* relationships
those engines jointly imply, and no durable rollback-authorization boundary
existed: `ROLLBACK_CANDIDATE` on `PostActionVerificationAssessment` is
explicitly documented as advisory-only (`adr-int-08`;
`docs/architecture/sprint-4-provenance-inventory.md` — "Rollback assessment
/ execution: MISSING").

**ADR numbering note:** the handbook reserves `ADR-INT-06` through
`ADR-INT-13` (see `adr-int-13-approval-action-policy.md`). This decision
uses **`ADR-INT-14`**, the next unused intelligence ADR identifier.

Critical invariants this ADR encodes (Task 2 of the Sprint 4 Engineer 2
brief):

```text
IMMATURE != READY
NOT_READY cannot execute
governance FAIL cannot be overridden by ML
HIGH confidence != APPROVED
ML EXECUTED != AUTHORITY
ML FAILED_SAFE cannot weaken governance
APPROVAL REQUIRED + missing approval cannot execute
API execution success != optimization success
INSUFFICIENT_EVIDENCE != successful verification
ROLLBACK_CANDIDATE != rollback authorization
```

## Decision

1. **Read-only release-qualification module, not a second governance
   engine.** `backend/governance-regression-eng2/` consumes an already-computed
   `DecisionLifecycleSnapshot` — one slice per Sprint 1-3 stage output — and
   never computes maturity, governance, confidence, readiness, ML decision,
   action policy, approval, execution, or verification itself. It is not
   wired into the runtime decision path (`decision-readiness` ->
   `action-policy` -> `execution`); it is invoked only by release
   qualification tooling and tests.

2. **Three outputs, cleanly separated.**
   - `invariants.ts` (Task 2): ten pure predicate functions, one per
     canonical invariant above, each returning a violation or `null`.
   - `contradiction-detector.ts` (Task 4): pure predicate functions over
     impossible/unsafe *combinations* of already-recorded state (including
     cross-tenant/cross-account input scope). Contradictions are reported,
     never corrected — this module never rewrites, deletes, or "fixes"
     stored historical records.
   - `safety-gate.ts` (Task 8): a deterministic `SAFE | BLOCKED |
     INSUFFICIENT_EVIDENCE` verdict. Precedence: any invariant violation or
     contradiction found in the evidence that *does* exist always yields
     `BLOCKED`, even if other evidence is also missing. Otherwise, missing
     critical evidence (readiness, action policy, governance context, or a
     required approval record) yields `INSUFFICIENT_EVIDENCE` rather than a
     false `SAFE`. Only a fully-evidenced, fully-consistent snapshot yields
     `SAFE`.

3. **Reuse, not reimplementation, of the ML boundary.** The ML invariants
   (`ML EXECUTED != AUTHORITY`, `ML FAILED_SAFE cannot weaken governance`)
   check for the presence of the exact reason codes
   `ACTION_POLICY_ML_EXECUTED_NON_AUTHORITY` and
   `ACTION_POLICY_ML_FAILED_SAFE_APPROVAL_UNCHANGED` that
   `action-policy/evaluate-action-policy.ts` already emits, rather than
   re-deriving ML non-authority from scratch. This directly regression-tests
   the Sprint 3 ML boundary instead of building a parallel one.

4. **Rollback authorization is a new, independently governed boundary
   (Task 5).** `backend/rollback-authorization/` is the single gate a caller
   must pass before invoking rollback execution. It:
   - refuses any request whose source is `ML` or `VERIFICATION_ENGINE` —
     only a `HUMAN_ACTOR` request can be authorized, closing the
     `ROLLBACK_CANDIDATE != rollback authorization` gap;
   - requires the same RBAC + privileged-MFA actor gate as any other
     privileged execution action, by **calling**
     `action-policy/evaluateActionPolicyActorGate` rather than
     reimplementing RBAC/MFA logic — this is the "extend Engineer 2's
     Sprint 3 action-policy work" instruction in the brief;
   - denies cross-tenant/cross-account requests outright by comparing
     `requestScope` against `executionScope`;
   - denies rollback on executions not in a rollback-eligible terminal
     state, or that have already been rolled back;
   - always returns an attributable `authorizedByActorId` +
     `authorizedAt` when authorized, and never populates either field on
     denial.
   - `auth/privileged-mfa.ts` already reserves
     `PRIVILEGED_OPERATIONS.EXECUTION_ROLLBACK` as an MFA-required
     privileged operation (pre-existing from Sprint 3/12 hardening); this
     module is the policy consumer of that existing reservation, not a new
     one.

5. **Fail-closed legacy audit, not legacy rewrite (Task 6).** The
   `engines/governance/` + `shared/constants` `GOVERNANCE_STATUS` /
   `READINESS_STATUS` pair is a separate, older engine used only by
   `orchestrator/workflow.orchestrator.ts`'s demo/simulation workflow.
   `execution/execution.simulator.ts` — the only execution surface that
   legacy orchestrator can reach — is documented in its own source as a
   "Mock execution layer — simulates applying an optimization without
   touching AWS." It has no code path to a real AWS mutation. The legacy
   path is therefore demonstrably safe by construction and is **not**
   modified by this sprint; see
   `docs/architecture/sprint-4-governance-regression-eng2-alt.md` §Task 6 for the
   full audit trail. The one real-AWS-mutating execution surface,
   `execution/execution-orchestrator.ts` via `ExecutionApiService`, was
   already fail-closed before this sprint
   (`action-policy/execution-eligibility-gate.ts`
   `assertProductionExecutionEligible` throws `ACTION_POLICY_MISSING` when
   a plan lacks a policy snapshot, and `ACTION_POLICY_NOT_ELIGIBLE` when
   eligibility isn't `ELIGIBLE`); this sprint adds the equivalent fail-closed
   gate for rollback (Task 5, item 4 above).

## Consequences

- Release pipelines gain one deterministic entry point
  (`evaluateReleaseSafetyGate`) instead of ad hoc per-sprint regression
  suites; existing per-sprint suites (`test:sprint1-*` .. `test:sprint4-*`)
  remain and are unaffected.
- Rollback execution now has an authorization boundary to call before
  mutating AWS state a second time (the rollback itself); previously only
  the *in-flight* orchestrator auto-rollback (triggered synchronously
  during a single `ExecutionOrchestrator.run()` call on step failure — see
  `tests/integration/execution-rollback-lifecycle.test.ts`) existed, and it
  is unaffected by this ADR since it never depends on a post-hoc
  `ROLLBACK_CANDIDATE` assessment.
- Both new modules are additive: no existing type, reason code, or
  function signature in `decision-readiness`, `governance-convergence`,
  `evidence-maturity`, `ml-decision`, `action-policy`, or
  `post-action-verification` was changed.
