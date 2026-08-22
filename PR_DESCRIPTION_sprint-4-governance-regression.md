# [Alternative implementation] Sprint 4 — Governance Regression & Unsafe-State Release Blocking (Engineer 2)

## ⚠️ Important context before reviewing

This PR was built independently, in parallel with **#282
("feat(governance): add Sprint 4 safety qualification")** and its follow-up
**#283 ("fix(governance): repair Sprint 4 qualification build")**, both
authored by Obianuju Florence and already merged to `main`. Both PRs
address the same ticket/brief.

I discovered the overlap after finishing this implementation and confirming
it independently: `#282`/`#283` cover all nine tasks in the brief, pass
59/59 tests, and type-check cleanly on `main` as of this writing.

**This PR is submitted for comparison, not as a replacement.** To avoid any
risk of overwriting or conflicting with the merged work, everything here
lives under disambiguated paths:

- `backend/governance-regression-eng2/` (not `governance-regression/`)
- `backend/tests/fixtures/sprint-4-governance-regression-eng2-alt/`
- `docs/architecture/sprint-4-governance-regression-eng2-alt.md`
- `docs/architecture/adr-int-14-eng2-alt-governance-regression-safety-gate.md`
- `npm run test:sprint4-governance-regression-eng2-alt` (not
  `test:sprint4-governance-regression`)

`backend/rollback-authorization/` and the individual test file names had no
path collisions with `#282`/`#283` and are unchanged.

**Recommended outcome:** do not merge this as-is. Use it, if useful, as a
reference for comparing invariant/contradiction design choices against the
merged version, then close without merging. Flagging to the team separately
that this ticket had two people working it in parallel.

## What this PR contains

Two new, read-only modules — nothing in Sprint 1-3's engines changed:

- `backend/governance-regression-eng2/` — 10 canonical safety invariants
  (Task 2), 6 contradiction checks (Task 4), and a deterministic
  `SAFE | BLOCKED | INSUFFICIENT_EVIDENCE` release safety gate (Task 8).
- `backend/rollback-authorization/` — the boundary between a
  `ROLLBACK_CANDIDATE` verification outcome and an authorized rollback
  (Task 5). Denies ML- and verification-engine-initiated requests, reuses
  `action-policy`'s RBAC/MFA actor gate, denies cross-tenant/cross-account
  requests, and always attributes an authorized decision to a human actor.

## Testing

```
$ npm run test:sprint4-governance-regression-eng2-alt
# tests 67
# pass 67
# fail 0

$ npx tsc --noEmit
(0 errors)
```

Full evidence: `docs/validation/sprint-4-governance-regression-matrix-report.md`.

## Docs

- `docs/architecture/sprint-4-governance-audit-inventory.md` — Task 1 audit
  of Sprint 1-3 contracts
- `docs/architecture/adr-int-14-eng2-alt-governance-regression-safety-gate.md`
- `docs/architecture/sprint-4-governance-regression-eng2-alt.md` — main doc,
  full per-scenario rationale table, Task 6 fail-closed audit
- `docs/validation/sprint-4-governance-regression-matrix-report.md`

**Branch:** `feature/sprint-4-governance-regression-eng2alt`
**Base:** `main`
