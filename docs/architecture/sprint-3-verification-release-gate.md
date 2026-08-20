# Sprint 3 Verification Release Gate

Engineer 4 extends the existing verification foundation with Sprint 3 post-action enterprise semantics, cross-module integration QA, and release-gate evidence.

## Existing foundation (preserved)

- `VerificationEngine` + `compareVerificationOutcome()` legacy statuses: `PENDING`, `VERIFIED`, `PARTIAL`, `FAILED`
- Engine repository: `backend/engines/verification/verification.repository.ts`
- Generic repository: `backend/repositories/contracts/verification-repository.ts`

## Repository convergence model

- **Authoritative:** engine `VerificationRepository` for comparator + Sprint 3 assessment persistence
- **Adapter:** `toVerificationRecordFromOutput()` maps to generic `VerificationRecord` when platform CRUD is needed
- **Not created:** third repository, `VerificationEngineV2`

## Sprint 3 post-action module

`backend/post-action-verification/`

- `evaluatePostActionVerification()` — enterprise outcome layer
- `PostActionVerificationService` — evaluate + persist via engine repository
- `buildSprint3LifecycleResult()` — canonical lifecycle answer object
- Policy version: `post-action-verification-v1`

## Outcome semantics

| Outcome | Meaning |
|---------|---------|
| `HEALTHY` | Sufficient acceptable post-action evidence; recommendation may persist |
| `RESOLVED` | Recommendation absent with sufficient evidence; comparator supports resolution |
| `DEGRADED` | Measurable deterioration |
| `INSUFFICIENT_EVIDENCE` | Missing/stale/NO_DATA evidence — never success |
| `ROLLBACK_CANDIDATE` | Advisory harmful outcome — **not rollback authorization** |

## ActionLog integration

`ActionLogEmitter.emitAfterPostActionVerification()` emits:

- `VERIFICATION_STARTED`
- `VERIFICATION_COMPLETED` or `VERIFICATION_INSUFFICIENT_EVIDENCE`

## Canonical fixtures

`backend/tests/fixtures/sprint-3-lifecycle/sprint-3-lifecycle-fixtures.ts`

Families include ML/no-ML paths, API-success verification scenarios, degradation, insufficient evidence, and cross-tenant denial inputs.

## Golden paths

- Cross-module: `tests/integration/sprint-3-cross-module-golden-path.test.ts`
- No-ML: `tests/integration/sprint-3-no-ml-verification-golden-path.test.ts`

## Failure matrix

`tests/integration/sprint-3-failure-degradation-matrix.test.ts` — exactly 19 rows.

## Validation script

```bash
cd backend
npm run test:sprint3-verification-release-gate
```

## Known limitations / Sprint 4 handoff

- Rollback execution control is not implemented
- `ROLLBACK_CANDIDATE` is advisory only
- Generic repository sync is adapter-based, not automatic dual-write
