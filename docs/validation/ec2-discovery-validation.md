# EC2 discovery validation

## Automated

- `backend/tests/unit/ec2-discovery-engine.test.ts` — normalization, repository upsert/stale rules, region limits, route order, SAM table.
- `backend/tests/unit/ec2-cloud-resource-pagination.test.ts` — scoped list `nextToken` encoding and rejection of malformed or cross-tenant/account tokens.
- `backend/tests/integration/ec2-discovery-conflict-http.test.ts` — optimistic-lock conflicts return **409** with code `CONFLICT` (sanitized; no DynamoDB internals).
- Full backend CI: `npm test`, `npm run build`, `sam validate --lint`.

## API error conventions (EC2)

- **409 `CONFLICT`**: `RepositoryConflictError` from inventory upserts or discovery-run completion (optimistic locking). Message is generic (`Resource version conflict.`); clients may retry the operation.
- **422 `INVALID_REQUEST`**: Malformed list filters or pagination tokens. List tokens are scoped to tenant, AWS account, and optional region/resourceType filters; unscoped or cross-scope tokens are rejected.
- **500 `ENGINE_ERROR`**: Unexpected internal failures return a fixed public message only; operators use structured server logs (request/correlation IDs, operation, error name) — not the HTTP body — for diagnosis.

## Manual (non-destructive)

1. Use production/staging API with verified account.
2. `POST .../ec2/discovery` with single region.
3. Confirm **200**, run status `SUCCEEDED` or `PARTIAL`, counts present.
4. `GET .../ec2/resources?accountId=...` returns normalized items with `firstSeenAt` / `lastSeenAt`.
5. Confirm no credentials in JSON responses.

## Out of scope

- Cost Explorer, Compute Optimizer, Config, metrics.
