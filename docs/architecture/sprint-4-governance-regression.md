# Sprint 4 — Governance Regression & Unsafe-State Release Blocking

## Objective

Prove that intelligence stages converge safely and contradictory or incomplete decision states cannot reach an unsafe production terminal state.

This is a **release qualification layer** over existing authoritative components. It does **not** replace:

- `GovernanceConvergence` / legacy governance engines
- `DecisionReadiness`
- `ActionPolicy`
- Rollback execution orchestrator

## Module layout

| Path | Role |
|------|------|
| `backend/governance-regression/types.ts` | Qualification input/result contract |
| `backend/governance-regression/reason-codes.ts` | Stable safety + contradiction codes |
| `backend/governance-regression/safety-invariants.ts` | Pure invariant helpers |
| `backend/governance-regression/contradiction-detector.ts` | Detect unsafe combinations (no mutation) |
| `backend/governance-regression/release-qualification.ts` | `SAFE` / `BLOCKED` / `INSUFFICIENT_EVIDENCE` |

## Release qualification semantics

```typescript
type GovernanceSafetyQualificationResult =
  | { result: 'SAFE'; reasonCodes: GovernanceSafetyReasonCode[] }
  | { result: 'BLOCKED'; reasonCodes: GovernanceSafetyReasonCode[]; contradictions: GovernanceContradiction[] }
  | { result: 'INSUFFICIENT_EVIDENCE'; reasonCodes: GovernanceSafetyReasonCode[] };
```

Rules:

1. Scope violation or safety contradiction → **BLOCKED**
2. Missing telemetry/pricing/verification/intelligence context preventing defensible qualification → **INSUFFICIENT_EVIDENCE**
3. Fully consistent lifecycle snapshot → **SAFE**
4. Never convert missing evidence into **SAFE**
5. Never treat ML as authority
6. Never treat execution API success as verified optimization success

Primary API:

```typescript
qualifyGovernanceSafety(input: GovernanceSafetyQualificationInput)
detectGovernanceContradictions(input: GovernanceSafetyQualificationInput)
```

Input slices mirror authoritative state (**references only** — qualification does not re-run upstream engines).

## Safety invariants (qualification assertions)

| Invariant | Enforcement |
|-----------|-------------|
| IMMATURE ≠ READY | Contradiction detector |
| NOT_READY cannot execute | Action Policy + contradiction |
| Governance FAIL cannot become execution eligible | Contradiction detector |
| Governance FAIL cannot be overridden by ML | Contradiction detector |
| HIGH confidence ≠ APPROVED | Contradiction flag |
| ML EXECUTED ≠ AUTHORITY | Action Policy reason codes + contradiction |
| ML FAILED_SAFE cannot weaken governance | Action Policy preserves approval; qualification blocks unsafe pairs |
| APPROVAL REQUIRED + missing approval cannot execute | Contradiction detector |
| API execution success ≠ optimization success | Contradiction detector |
| INSUFFICIENT_EVIDENCE ≠ successful verification | Post-action + contradiction |
| ROLLBACK_CANDIDATE ≠ rollback authorization | Rollback boundary tests — candidate alone may be SAFE; unauthorized authorization is BLOCKED |

## Contradiction semantics

Contradictions are **detected, not corrected**. Historical contradictory records remain historically truthful and are classified **BLOCKED** for release qualification.

See `GOVERNANCE_CONTRADICTION_*` codes in `backend/governance-regression/reason-codes.ts`.

## Governance regression matrix

Canonical scenarios (fixtures in `backend/tests/fixtures/sprint-4-governance/`):

- Recommendation without mature evidence
- Mature evidence + governance failure
- Governance pass + insufficient confidence
- NOT_READY + high ML confidence
- ML unavailable / corrupt output paths (via Action Policy + ML fixtures)
- Pricing / telemetry unavailable → INSUFFICIENT_EVIDENCE
- Missing / rejected / stale approval
- Execution provider failure (Sprint 3 matrix — preserved)
- Verification insufficient
- Post-action deterioration (Sprint 3 post-action fixtures)
- Rollback candidate without authorization (advisory-only SAFE path)
- Unauthorized rollback authorization (BLOCKED)
- Cross-tenant decision input

## Rollback authorization boundary

**Precise semantics:** ROLLBACK_CANDIDATE is advisory and is not rollback authorization. A candidate state does not itself block an otherwise safe release; any unauthorized rollback authorization or execution is release-blocking.

Qualification evaluates the **complete** snapshot:

| Rollback slice | Qualification when otherwise safe |
|----------------|-----------------------------------|
| `rollbackCandidate: true`, no authorization flags | **SAFE** — advisory only |
| Unauthorized authorization (missing RBAC/MFA/attribution) | **BLOCKED** |
| ML or verification attempts rollback authorization | **BLOCKED** |
| Cross-tenant rollback authorization | **BLOCKED** |
| Authorization claimed without candidate evidence | **BLOCKED** — contradictory rollback evidence |
| Candidate advisory + missing telemetry/pricing context | **INSUFFICIENT_EVIDENCE** — general evidence gap, not because candidate is advisory |

`ROLLBACK_CANDIDATE` must **never** imply:

- rollback authorization
- rollback execution
- privileged rollback approval

Proven at qualification + existing execution API tests:

- Scenario A: candidate + no authorization + otherwise safe → **SAFE**
- Scenario B–E: unauthorized authorization paths → **BLOCKED** with stable contradiction codes
- Scenario F: contradictory authorization claims → **BLOCKED**; missing non-rollback evidence → **INSUFFICIENT_EVIDENCE** per existing qualification order

No second rollback service introduced. Runtime rollback execution remains unchanged (Engineer 4 deferred).

## Legacy fail-closed behavior

| Path | Behavior |
|------|----------|
| Simulation | PRESERVED_SAFE |
| NOT_READY production | FAIL_CLOSED via Action Policy |
| Missing authorization/MFA | FAIL_CLOSED via actor gate |
| Durable rollback ActionLog | DEFERRED |

Extends Sprint 3 legacy-safety tests; does not replace them.

## Security regression evidence

Tests in `tests/integration/sprint-4-governance-regression-security.test.ts`:

- Cross-tenant / cross-account verification scope
- Safe-not-found verification lookup
- RBAC denial for approve/rollback
- MFA required for privileged approve/rollback

## Validation

```bash
npm run test:sprint4-governance-regression
```

Golden vectors:

- `SAFE_FULLY_CONSISTENT`
- `BLOCKED_IMMATURE_READY_CONTRADICTION`
- `BLOCKED_GOVERNANCE_FAIL_EXECUTION_ELIGIBLE`
- `BLOCKED_MISSING_APPROVAL`
- `BLOCKED_ROLLBACK_WITHOUT_AUTHORIZATION`
- `INSUFFICIENT_MISSING_TELEMETRY`
- `INSUFFICIENT_MISSING_PRICING`
- `INSUFFICIENT_VERIFICATION_EVIDENCE`
- `ML_HIGH_NON_AUTHORITY`
- `ML_FAILED_SAFE_PRESERVES_GOVERNANCE`
- `CROSS_TENANT_DECISION_DENIED`

## Related work

- Sprint 4 Engineer 1 — provenance reconstruction (`docs/architecture/sprint-4-provenance-reconstruction.md`)
- Sprint 4 Engineer 2 approval override — existing execution API + legacy-safety tests
- Audit inventory — `docs/architecture/sprint-4-governance-regression-audit.md`
