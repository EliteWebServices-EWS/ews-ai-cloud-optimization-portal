# Sprint 11 persistence migration

This document describes how to migrate exported in-memory or backup JSON records into the Sprint 11 DynamoDB business tables using the hardened migration script.

## Script entry point

From the `backend` directory:

```bash
npm run migrate:persistence
```

The script lives at `backend/scripts/migrate-memory-to-dynamodb.ts` and does not depend on integration test harness code.

## Export format

The source file (see `MIGRATION_SOURCE_PATH`) must be a JSON object with optional arrays:

- `workflows`
- `ownership`
- `reports`
- `learning`
- `verifications`

Each array element is a complete DynamoDB item including `pk` and `sk`. At least one section must contain records.

Example:

```json
{
  "workflows": [
    {
      "pk": "TENANT#tenant-a",
      "sk": "WORKFLOW#wf-123",
      "entityType": "WORKFLOW",
      "tenantId": "tenant-a",
      "workflowId": "wf-123",
      "status": "PENDING",
      "provider": "mock",
      "version": 1,
      "createdAt": "2026-07-22T10:00:00.000Z",
      "updatedAt": "2026-07-22T10:00:00.000Z"
    }
  ]
}
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MIGRATION_SOURCE_PATH` | Yes | Path to the JSON export file. |
| `MIGRATION_DRY_RUN` | No | When `true`, validates the export and prints counts without writing or calling STS. |
| `MIGRATION_MODE` | No | `insert-only` (default) or `upsert`. |
| `MIGRATION_ENVIRONMENT` | Yes (non-dry-run) | Target label: `dev`, `staging`, or `production`. Never inferred automatically. |
| `MIGRATION_CONFIRM_TARGET` | Yes for `production` | Must equal the confirmation token printed by the script (`account:region:sortedTableNames`). |
| `MIGRATION_EXPECTED_ACCOUNT_ID` | Recommended | If set, STS `GetCallerIdentity` account must match. |
| `MIGRATION_SOURCE_SHA256` | Optional | If set, SHA-256 of the source file must match (lowercase hex). |
| `MIGRATION_ALLOW_UPSERT` | For production upsert | Must be `true` when `MIGRATION_MODE=upsert` and `MIGRATION_ENVIRONMENT=production`. |
| `MIGRATION_ON_CONFLICT` | No | `continue` (default) or `fail` for insert-only conflicts. |
| `WORKFLOWS_TABLE_NAME` | When export has workflows | Target workflows table. |
| `OWNERSHIP_TABLE_NAME` | When export has ownership | Target ownership table. |
| `REPORTS_TABLE_NAME` | When export has reports | Target reports table. |
| `LEARNING_TABLE_NAME` | When export has learning | Target learning table. |
| `VERIFICATIONS_TABLE_NAME` | When export has verifications | Target verifications table. |
| `AWS_REGION` | No | Default `us-east-1`. |
| `DYNAMODB_ENDPOINT` | No | Optional DynamoDB Local endpoint. |

## Migration modes

### Insert-only (default)

- Uses conditional `PutCommand` with `attribute_not_exists(pk) AND attribute_not_exists(sk)` for new items.
- Existing identical item: counted as `skipped-identical`.
- Existing different item: counted as `conflicted`; target row is not overwritten.
- Emits counts: `inserted`, `skipped-identical`, `conflicted`, `failed`.

### Upsert

- Enabled only with `MIGRATION_MODE=upsert`.
- Overwrites existing items (`PutCommand` without conditions).
- Production upsert additionally requires `MIGRATION_ALLOW_UPSERT=true` and production confirmation via `MIGRATION_CONFIRM_TARGET`.

## Pre-flight checks (non-dry-run)

Before the first write, the script:

1. Validates the full export (keys, tenant IDs, versions, timestamps, entity types).
2. Rejects empty exports or exports with no recognized sections.
3. Calls AWS STS `GetCallerIdentity` and logs account ID, region, mode, environment, and target table names.
4. Verifies `MIGRATION_EXPECTED_ACCOUNT_ID` when configured.
5. Requires `MIGRATION_CONFIRM_TARGET` to match the printed token when `MIGRATION_ENVIRONMENT=production`.
6. Verifies `MIGRATION_SOURCE_SHA256` when configured.

Record contents, tokens, and secrets are never logged.

## Post-write verification

After writes complete, the script re-reads each inserted or skipped-identical key with `GetCommand`, compares tracked counts, and exits with a non-zero status if verification fails.

## Recommended procedure

1. **Prepare export** from a trusted backup or operational export tool. Compute SHA-256 if you want an integrity gate:

   ```bash
   sha256sum export.json
   ```

2. **Dry-run** against the same file and table env vars:

   ```bash
   export MIGRATION_SOURCE_PATH=./export.json
   export MIGRATION_DRY_RUN=true
   export WORKFLOWS_TABLE_NAME=sisum-workflows-dev
   npm run migrate:persistence
   ```

3. **Non-production insert-only** run with account guard:

   ```bash
   export MIGRATION_DRY_RUN=false
   export MIGRATION_ENVIRONMENT=dev
   export MIGRATION_EXPECTED_ACCOUNT_ID=111122223333
   export WORKFLOWS_TABLE_NAME=sisum-workflows-dev
   npm run migrate:persistence
   ```

4. **Production** requires the confirmation token from a prior dry-run or STS log line:

   ```bash
   export MIGRATION_ENVIRONMENT=production
   export MIGRATION_CONFIRM_TARGET=111122223333:us-east-1:sisum-workflows-prod
   export MIGRATION_EXPECTED_ACCOUNT_ID=111122223333
   npm run migrate:persistence
   ```

5. Review stdout counts and ensure exit code `0`.

## Rollback

The migration script does not delete or replace tables. Insert-only mode does not overwrite conflicting rows. Roll back by restoring from DynamoDB point-in-time recovery or by re-importing a known-good export into a fresh table; do not use upsert against production unless overwrite is explicitly intended.

## Testing

Unit tests: `backend/tests/unit/migrate-memory-to-dynamodb.test.ts` (run via `npm test` in `backend`).
