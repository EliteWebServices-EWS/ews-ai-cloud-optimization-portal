# Tenant owner bootstrap — security

## Controls

| Control | Implementation |
|---------|------------------|
| Tenant binding | `tenantId` only from trusted request context |
| Registry required | `TenantRepository.getById`; must be **ACTIVE**; **DELETED** → safe 404 |
| No implicit tenant | JWT `tenant_id` without registry record → 404 |
| Legacy membership | Consistent `Query` `MEMBER#` prefix, `Limit=1`, no Scan — any hit → 409 |
| Concurrency | TransactWrite: `OWNER_BOOTSTRAP` + membership, conditional puts |
| Platform + MFA | Cognito `admin` + `TENANT_OWNER_BOOTSTRAP` privileged MFA |
| Self only | `userId` from authenticated sub only |

## Query vs transaction

- **Query** protects tenants that already have membership items created before bootstrap markers existed (manual ops, older scripts).
- **Transaction marker** protects simultaneous bootstrap on an empty tenant partition.

Both are required; neither replaces the other.

## Audit

`tenant.owner_bootstrap_denied` for existing membership and ineligible tenant outcomes — safe reason codes only, no member identities in responses or audit payloads.

## Direct DynamoDB insertion

Discouraged: bypasses MFA, audit, marker pairing, and legacy detection.

## Remaining limitations

- Small race window: query sees empty partition while another request completes transact — resolved by transaction conditions on retry (409).
- Does not inspect invitation records; only durable `MEMBER#` items count.
