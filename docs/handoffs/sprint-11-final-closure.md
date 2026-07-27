# Sprint 11 final closure — production hardening

Branch: `fix/sprint-11-production-hardening`  
Baseline (origin/main): 289 tests, 284 pass, 5 skipped.  
Hardened branch: **319 tests, 314 pass, 0 fail, 5 skipped** (DynamoDB Local bench still skipped unless configured).

## Requirement matrix

| Requirement | Implementation evidence | Test evidence | Non-prod validation | Status |
|-------------|---------------------------|---------------|---------------------|--------|
| Conditional ownership writes | `ensureEngineOwnership`, `SAME_OWNER_CONDITION` on contract + engine paths | `engine-ownership.test.ts`, `dynamodb-ownership-repository.test.ts` | Manual workflow: `.github/workflows/sprint-11-persistence-validation.yml` | PASS |
| Atomic report / verification writes | `executeTransactWrite` for report+pointer+ownership; `transactPutItems` for verification | `dynamodb-report.repository.test.ts`, `dynamodb-verification.repository.test.ts` | DynamoDB Local workflow (unit-level transact via fake client) | PASS |
| Append-only history keys | `buildAppendOnlyKeySuffix` (`ISO#uuid`) | `history-concurrent-append.test.ts` | Fake client concurrency | PASS |
| Bounded pagination | `PersistenceTable.queryPageByPrefix`, scoped tokens | `persistence-table-pagination.test.ts`, report query tests | Workflow list + report API already paginated | PASS |
| Migration insert-only default | `migrate-memory-to-dynamodb.ts` modes + STS preflight | `migrate-memory-to-dynamodb.test.ts` (19 cases) | Dry-run only in CI | PASS |
| Deployed fail-closed persistence | `validateDeployedPersistenceConfig` in `createApp` / factories | `persistence-config.test.ts` | SAM env supplies all table names in Lambda | PASS |
| No application Scan | Removed unused `backend/src/tenants.js` | Repo grep (Phase 13) | — | PASS |
| TTL / retention | `expiresAt` on engine writes via `persistence/retention.ts` | Unit saves include `expiresAt` in fake store items | Table TTL attribute configured in SAM | PARTIAL |
| Real DynamoDB concurrency | Architecture supports; measured bench optional | `performance-and-validation.test.ts` **skipped** without endpoint | Manual workflow dispatch | NOT RUN |
| Engine/contract consolidation | Shared persistence utilities + ADR | ADR `docs/architecture/adr-sprint-11-engine-repository-adapters.md` | — | PARTIAL |

## Known limitations

- Report/learning/verification **engine adapters** remain separate from contract repositories (documented ADR).
- Report `query()` applies search/filter/sort to the **current bounded DynamoDB page**; clients needing full-tenant analytics must paginate explicitly.
- DynamoDB Local full-stack bench is manual (`workflow_dispatch`); default PR CI does not require Docker.
- Migration upsert requires explicit production confirmation flags.

## Risks

- Cross-table transactions increase blast radius on conditional failure (mapped to typed conflicts).
- Legacy numeric history keys remain readable; mixed key formats coexist until natural TTL expiry.

## Rollback

1. Revert merge commit on `main`.
2. Redeploy previous Lambda artifact (no table replacements in this branch).
3. Ownership and report data written under new keys remain compatible with prior readers.

## Sprint 12 go / no-go

**Recommendation: GO with documented limitations.**

Sprint 11 production safety goals for ownership, bounded reads, migration defaults, and deployed fail-closed configuration are implemented and covered by automated tests. Complete measured DynamoDB Local/ AWS non-prod bench should be executed via the manual validation workflow before production cutover, and engine/contract consolidation should be scheduled early in Sprint 12.
