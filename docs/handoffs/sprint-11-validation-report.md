# Sprint 11 validation report

Generated during `fix/sprint-11-workflow-persistence-build`. Evidence paths are relative to the repository root.

## DynamoDB foundation

| Requirement | Status | Evidence | Gap | Recommended correction |
|-------------|--------|----------|-----|------------------------|
| Workflows table | PASS | `backend/template.yaml` → `SisumWorkflowsTable` | — | — |
| Reports table | PASS | `backend/template.yaml` → `SisumReportsTable` | — | — |
| Learning table | PASS | `backend/template.yaml` → `SisumLearningTable` | — | — |
| Verification table | PASS | `backend/template.yaml` → `SisumVerificationsTable` | — | — |
| Ownership table | PASS | `backend/template.yaml` → `SisumOwnershipTable` | — | — |
| Tenant PK/SK design | PASS | `backend/database/dynamodb-keys.ts` (`tenantPartitionKey`, sort keys) | — | — |
| Encryption (SSE) | PASS | `SSESpecification.SSEEnabled: true` on business tables in `backend/template.yaml` | — | — |
| Point-in-time recovery | PASS | `PointInTimeRecoverySpecification` enabled on business tables | — | — |
| TTL | PASS | `TimeToLiveSpecification.AttributeName: expiresAt` | — | — |
| GSIs for access patterns | PASS | `gsi1` on workflows/reports/learning/verifications (`GlobalSecondaryIndexes`) | Ownership table has no GSI (lookup by pk only) | Acceptable for ownership access pattern |
| Least-privilege Lambda IAM | PASS | `SisumBusinessPersistencePolicy` scoped to table ARNs + indexes; audit policy Put/Query only | Execution role ARN referenced by name (role body may live outside repo) | Confirm role definition in deployment pipeline |
| No application Scan (SISU'M backend) | PASS | TypeScript repos use `QueryCommand` only; legacy `backend/src/tenants.js` removed (unused Scan helper) | — | — |
| Conditional writes | PASS | Contract repos + engine ownership/report/verification transactions | — | — |
| Optimistic locking | PASS | `buildVersionedUpdateExpression` in `backend/repositories/dynamodb/base-dynamodb-repository.ts`; workflow updates use version condition | Engine-layer DynamoDB adapters may not version every write | Extend engine adapters if cross-Lambda write safety required for all entities |
| Version fields | PASS | `WorkflowRecord.version`, repository models in `backend/repositories/models/persistence-models.ts` | — | — |
| Pagination tokens | PASS | `encodeNextToken` / `decodeNextToken` in `backend/database/pagination-token.ts`; repository `listByTenant` / `listByStatus` | — | — |

## Workflow persistence

| Requirement | Status | Evidence | Gap | Recommended correction |
|-------------|--------|----------|-----|------------------------|
| Production DynamoDB storage | PASS | `createWorkflowStore()` → `RepositoryBackedWorkflowStore` when `shouldUseDurableWorkflowStore()` (`backend/orchestrator/workflow.store.ts`) | — | — |
| Record fields (tenant, status, metadata, timestamps, version, idempotency) | PASS | `WorkflowMetadata`, persisted `WorkflowRecord`, `RepositoryBackedWorkflowStore.save` | — | — |
| Lifecycle pending/running/completed/failed | PASS | `WORKFLOW_STATES`, `toPersistedStatus`, orchestrator `executeWorkflow` | — | — |
| Duplicate workflow prevention | PASS | Conditional create + `RepositoryAlreadyExistsError`; orchestrator idempotent workflow id | — | — |
| Idempotent execution | PASS | `deriveIdempotentWorkflowId`, replay in `executeWorkflow`, concurrency test | — | — |
| Optimistic version locking | PASS | `DynamoDbWorkflowRepository.update`, `updateWithRetry` in `workflow.repository-store.ts` | — | — |
| No in-memory fallback when tables configured | PASS | `shouldUseDurableWorkflowStore()` + `template.yaml` env for Lambda | Local dev without env uses `InMemoryWorkflowStore` (expected) | — |
| APIs read from repository | PASS | `WorkflowOrchestrator` uses `WorkflowStoreInterface` only | — | — |
| Tenant-scoped reads | PASS | `recordBelongsToTenant`, ownership resolution for 404 | — | — |
| Safe cross-tenant HTTP 404 | PASS | `handleTenantScopedResourceMiss` in workflow routes | — | — |
| Audit distinguish missing vs cross-tenant | PASS | `resolveWorkflowOwnerTenantId` + tenant route helpers | — | — |
| Cold start durability | PASS | DynamoDB-backed store in deployed config | CI integration tests often use in-memory store | Rely on unit/repo tests + optional DynamoDB Local bench |
| Workflow list HTTP pagination | PASS | `GET /workflows` with `limit`, `nextToken`, `items` (`backend/api/routes/index.ts`, `parseWorkflowListQuery`) | New contract; clients must use paginated shape | Document in API handoff |

## Report / learning / verification persistence

| Requirement | Status | Evidence | Gap | Recommended correction |
|-------------|--------|----------|-----|------------------------|
| Production DynamoDB repositories | PASS | `createReportingEngine`, `createLearningStore`, `createVerificationEngine` select `DynamoDb*Repository` when table env vars set | Parallel contract repos under `backend/repositories/dynamodb/` not wired to engines | Consolidate or keep dual path documented |
| Tenant isolation | PASS | Tenant pk queries; mock/repo tests under `backend/tests/integration/tenant-isolation.test.ts` | — | — |
| Durable ownership | PASS | Ownership table + engine repo owner indexes | — | — |
| Report history / query | PASS | `ReportingEngine.queryReports`, `GET /reports` pagination | In-memory mock loads all pages for query | Acceptable for tests |
| Pagination via APIs | PASS | Reports and audit list endpoints expose `nextToken` | Learning list endpoints may aggregate in memory | Add paginated learning API if product requires |
| No Map fallback when tables configured | PASS | Factory functions in `report.engine.ts`, `learning.store.ts`, `verification.engine.ts` | Constructor default on `ReportingEngine` is mock if repository omitted | Always use factory in production (`createApp`) |

## Integration and migration

| Requirement | Status | Evidence | Gap | Recommended correction |
|-------------|--------|----------|-----|------------------------|
| Integration tests for repositories | PASS | `backend/tests/integration/report.test.ts`, `verification.test.ts`, `workflow*.test.ts`, `workflow-concurrency.test.ts` | — | — |
| Migration migrates supported entities | PARTIAL | `backend/scripts/migrate-memory-to-dynamodb.ts` imports JSON export sections | No automatic export from legacy in-memory Maps | Produce export JSON from operational backup before migrate |
| Migration idempotent | PASS | Default `insert-only` conditional puts; optional upsert with explicit confirmation | `migrate-memory-to-dynamodb.test.ts` | — |
| BatchWrite retry | PASS | Bounded exponential backoff in migration script | — | — |
| No test harness import | PASS | Script uses standalone `DynamoDBClient` factory | — | — |
| Configurable source/target | PASS | `MIGRATION_SOURCE_PATH`, per-entity `*_TABLE_NAME`, `DYNAMODB_ENDPOINT` | — | — |
| Dry-run | PASS | `MIGRATION_DRY_RUN=true` | — | — |
| Cold-start validation | PARTIAL | `performance-and-validation.test.ts` (skipped unless `DYNAMODB_ENDPOINT` + `DYNAMODB_TABLE_NAME`) | Skipped in default CI | Run manually against DynamoDB Local for measured report |
| Concurrency / conditional writes | PASS | `workflow-concurrency.test.ts` with `FakeDynamoTable` | — | — |
| Pagination nextToken tests | PASS | `workflow-list.test.ts`, `report.query.test.ts`, repository unit tests | — | — |
| Tenant isolation (two partitions) | PASS | `tenant-isolation.test.ts`, `tenant-access-denied.test.ts` | — | — |
| Performance measured results | PARTIAL | Bench test logs latency to console when enabled | Not captured as structured report artifact | Export metrics to file in bench test if required |

## Map usage classification (backend)

| Location | Classification |
|----------|----------------|
| `InMemoryWorkflowStore`, mock report/learning/verification repos | Test/local mock — acceptable |
| `FakeDynamoTable`, `fake-persistence-table` | Test double — acceptable |
| `plugins/index.ts` `Map` | Plugin registry — acceptable |
| `request-security-context.ts` `WeakMap` | Request-local cache — acceptable |

## Validation commands (this branch)

| Command | Result |
|---------|--------|
| `npm ci` | Pass |
| `npm test` | Pass (314 passed, 5 skipped DynamoDB Local bench) |
| `npm run build` | Pass |
| `sam validate --lint` | Pass |
| `sam build --no-cached` | Pass |
| `git diff --check` | Pass (at commit time) |

## Notes

- Integration tests for reporting already `await` async repository methods and use `getRepository()` (`backend/tests/integration/report.test.ts`).
- Verification integration test does not place `completedAt` on `OptimizationContext`; completion time remains on execution/observation structures.
- Legacy portal `backend/src/tenants.js` Scan helper removed (not referenced by SISU'M Lambda).
- See `docs/handoffs/sprint-11-final-closure.md` for go/no-go and measured validation status.
