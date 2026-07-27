# Engineering persistence report (Sprint 11 hardening)

**Branch:** `fix/sprint-11-production-hardening`
**Scope:** SISU'M multi-tenant DynamoDB foundation (workflows, reports, learning, verification, ownership).

## Validation status (honest)

| Area | Status | Notes |
|------|--------|-------|
| Unit + integration tests (`npm test`) | PASS | 314 passed, 5 skipped (DynamoDB Local bench) |
| TypeScript build | PASS | `npm run build` |
| SAM template | PASS | `sam validate --lint`, `sam build --no-cached` |
| Ownership conditional writes | PASS | Engine + contract repositories |
| TransactWrite report/verification | PASS | Fake client + unit tests |
| Bounded pagination | PASS | `queryPageByPrefix` + tenant-scoped tokens |
| Migration insert-only default | PASS | 19 migration unit tests |
| Deployed fail-closed config | PASS | `validateDeployedPersistenceConfig` |
| Measured DynamoDB Local bench | NOT RUN | Requires `DYNAMODB_ENDPOINT`; use manual GitHub workflow |
| Real AWS non-prod concurrency | NOT RUN | Optional workflow input |

## Architecture (summary)

- **Tenant partitions:** `TENANT#<tenantId>` pk on business tables.
- **Ownership index:** `RESOURCE#<TYPE>#<id>` pk on ownership table (cross-tenant read for safe 404 only).
- **Conditional writes:** create + same-owner idempotent ownership.
- **Transactions:** report save (report + pointer + ownership); verification save (output + execution pointer).
- **Pagination:** opaque tokens; scoped to tenant + query shape for engine list pages.
- **History:** append-only `timestamp#uuid` sort keys (legacy numeric keys still readable).
- **Migration:** JSON export → conditional insert-only by default; STS + confirmation guards.

See `docs/handoffs/sprint-11-final-closure.md` for go/no-go.
