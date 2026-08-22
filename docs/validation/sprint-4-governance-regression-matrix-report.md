# Sprint 4 Governance Regression Matrix — Validation Report

Engineer: Sprint 4 Engineer 2 — Governance Regression & Unsafe-State Release Blocking
Branch: `feature/sprint-4-governance-regression`
Command: `npm run test:sprint4-governance-regression`
(equivalently: `tests/unit/governance-regression-invariants.test.ts`,
`tests/unit/governance-regression-contradiction-detection.test.ts`,
`tests/unit/rollback-authorization.test.ts`,
`tests/integration/sprint-4-governance-regression-matrix.test.ts`,
`tests/security/sprint-4-governance-security-regression.test.ts`)

## Result

```
# tests 67
# suites 8
# pass 67
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

`npx tsc --noEmit` across the full backend: **0 errors.**

Full run also verified with no regressions against pre-existing Sprint 3
suites it touches conceptually (`action-policy-evaluate.test.ts`,
`sprint-3-approval-action-policy-authorization.test.ts`,
`sprint-3-ml-non-authority.test.ts`, `execution-api-rollback.test.ts`,
`execution-rollback-lifecycle.test.ts`, `execution-rollback-integrity.test.ts`,
`execution-tenant-isolation.test.ts`) — combined run: **111/111 pass.**

## Task 2 — canonical safety invariants (17 tests)

`tests/unit/governance-regression-invariants.test.ts`. Confirms:

- the baseline snapshot violates nothing (negative control),
- each of the 10 invariants fires on the exact condition it targets,
- each invariant's negative case (the condition correctly held) produces no
  violation — e.g. ML EXECUTED *with* the non-authority reason code
  recorded is confirmed safe, not just ML EXECUTED without it unsafe,
- the rollback-authorization invariant is tested against three distinct
  unsafe paths (candidate-flag-alone, ML-authorized, verification-invoked)
  and one safe path (attributed human authorization).

## Task 4 — contradiction detection (10 tests)

`tests/unit/governance-regression-contradiction-detection.test.ts`.
Confirms:

- the baseline snapshot has zero contradictions,
- each of the 5 required combinations from the brief is detected, plus
  cross-tenant/cross-account input scope (6th, brief's Task 4 example list
  + Task 3's scenario 16),
- account-level isolation is enforced independently of tenant-level
  isolation (same tenant, different account is still flagged),
- contradiction detection is read-only — the input snapshot is
  byte-for-byte unchanged after detection runs.

## Task 3 + Task 8 — regression matrix through the release safety gate (19 tests)

`tests/integration/sprint-4-governance-regression-matrix.test.ts`. All 16
required scenarios resolve to the documented expected verdict (14 × `SAFE`,
2 × `BLOCKED`, 2 × `INSUFFICIENT_EVIDENCE`across `pricing unavailable` /
`telemetry unavailable`) — see the table in
`docs/architecture/sprint-4-governance-regression-eng2-alt.md` for the full
per-scenario rationale. Additional properties verified:

- the gate is deterministic — every scenario produces byte-identical
  results across two evaluations,
- every `BLOCKED` verdict carries an invariant-violation or contradiction
  reason code (never `BLOCKED` with an empty explanation),
- every `INSUFFICIENT_EVIDENCE` verdict carries the dedicated reason code
  and zero invariant violations/contradictions (missing evidence is never
  conflated with an active safety violation),
- every `SAFE` verdict has zero recorded invariant violations or
  contradictions.

## Task 5 — rollback authorization boundary (13 tests)

`tests/unit/rollback-authorization.test.ts`. Confirms, against
`evaluateRollbackAuthorization`:

| Requirement | Test | Result |
|---|---|---|
| ROLLBACK_CANDIDATE alone cannot execute rollback | denies when `verificationOutcome !== 'ROLLBACK_CANDIDATE'` | pass |
| ML cannot authorize rollback | denies `requestedBy.source === 'ML'`, `authorizedByActorId` stays `null` | pass |
| verification cannot invoke rollback directly | denies `requestedBy.source === 'VERIFICATION_ENGINE'` | pass |
| privileged rollback preserves RBAC | denies `authorized: false` actor | pass |
| privileged rollback preserves MFA | denies `mfaVerified: false` actor | pass |
| cross-tenant rollback is denied | denies mismatched `tenantId` | pass |
| (extension) cross-account rollback is denied | denies same tenant, mismatched `accountId` | pass |
| rollback authorization is attributable | denies an otherwise-valid request with `actorId: null`; confirms every authorized decision carries both `authorizedByActorId` and `authorizedAt` | pass |
| (extension) execution-state / already-rolled-back guards | denies non-rollback-eligible state, denies double rollback | pass |
| positive control | a fully valid human, authorized, MFA-verified, in-scope request is authorized | pass |

## Task 7 — security regression (7 tests)

`tests/security/sprint-4-governance-security-regression.test.ts`:

| Requirement | Evidence |
|---|---|
| Tenant A cannot approve/execute/verify Tenant B | Reused, unmodified: `tests/security/execution-tenant-isolation.test.ts`, `tests/security/sprint-3-approval-action-policy-authorization.test.ts` (still passing — see combined run above) |
| Tenant A input cannot contribute to a Tenant B decision | `detectContradictions` cross-tenant test, this suite |
| Tenant A cannot rollback Tenant B | `evaluateRollbackAuthorization` cross-tenant test, this suite |
| unauthorized role cannot approve | `canPerformExecutionPrivilegedAction` + `evaluateActionPolicyActorGate` denial, this suite |
| unauthorized role cannot rollback | `evaluateRollbackAuthorization` denial for `TENANT_ROLES.ANALYST`, this suite |
| missing MFA cannot approve privileged production action | `evaluatePrivilegedMfa` + `evaluateActionPolicyActorGate` denial, this suite |
| missing MFA cannot rollback privileged production action | `evaluatePrivilegedMfa` + `evaluateRollbackAuthorization` denial, this suite |
| positive control | fully authorized + MFA-verified tenant owner succeeds at rollback |

## Task 6 — fail-closed legacy audit (documentation, no test changes required)

Audited both execution surfaces in the codebase; findings and rationale are
in `docs/architecture/sprint-4-governance-regression-eng2-alt.md` §Task 6 and
`docs/architecture/adr-int-14-eng2-alt-governance-regression-safety-gate.md` §5:

- The real AWS-mutating path (`ExecutionApiService` /
  `execution-orchestrator.ts`) was already fail-closed via
  `action-policy/execution-eligibility-gate.ts` before this sprint — no
  change needed.
- The legacy demo/simulation path (`orchestrator/workflow.orchestrator.ts`)
  is backed exclusively by `ExecutionSimulator`, which cannot mutate real
  AWS state by construction (confirmed by reading its source and doc
  comment). It is therefore demonstrably safe as-is; no change was made to
  avoid unnecessary scope creep against a path with no actual production
  risk, and no historical data was altered.

## Reason-code stability

All new reason codes (`GOVREG_*`, `ROLLBACK_AUTH_*`) are additive and
namespaced separately from every existing Sprint 1-3 reason-code
enumeration (`ACTION_POLICY_*`, `DECISION_READINESS_*`, etc.) — no existing
code was renumbered, repurposed, or removed.
