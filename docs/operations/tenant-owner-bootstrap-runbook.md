# Tenant owner bootstrap runbook

## Purpose

New deployments may have Cognito users (platform `admin` group, trusted `tenant_id`) but **zero rows** in the memberships table. Normal membership APIs require an existing `tenant_owner` or `tenant_admin`, which creates a chicken-and-egg problem. **`POST /api/v1/tenants/bootstrap-owner`** performs a **one-time**, concurrency-safe bootstrap of the caller as `tenant_owner`.

## Preconditions

1. Caller is authenticated with a recognized SISUM role.
2. Trusted `tenant_id` on the access token (via API Gateway / Lambda internal headers in production).
3. **Tenant registry record exists** for that tenant id and status is **ACTIVE** (JWT `tenant_id` alone does not create a tenant).
4. Caller is in the platform Cognito **`admin`** group (`SISUM_ROLES.ADMIN`).
5. Current-session MFA evidence: `mfa_session_verified=true` on the access token.
6. Tenant partition has **no** existing `MEMBER#*` items (any status, including legacy rows without an `OWNER_BOOTSTRAP` marker).
7. Bootstrap marker `OWNER_BOOTSTRAP` not yet present.

## Two-layer enforcement

1. **Legacy membership query (pre-transaction):** strongly consistent `Query` on `pk=TENANT#{tenantId}` with `begins_with(sk, MEMBER#)`, `Limit=1`. Blocks tenants that already have hand-seeded or pre-marker memberships.
2. **Atomic transaction:** `TransactWriteItems` creates `OWNER_BOOTSTRAP` + first `MEMBER#{userId}` with `attribute_not_exists` conditions. Blocks concurrent empty-tenant bootstrap races.

## Procedure

```http
POST /api/v1/tenants/bootstrap-owner
Content-Type: application/json

{}
```

Do **not** send `tenantId`, `userId`, `role`, `memberId`, or `addedBy` in the body — the server rejects them.

**Success (201):** `{ member: { ... tenant_owner, ACTIVE, version: 1 } }`

## Failure responses

| Status | Meaning |
|--------|---------|
| 401 | Unauthenticated |
| 403 | Not platform admin, missing MFA, or missing trusted user id |
| 404 | Tenant registry record missing or **DELETED** |
| 409 | `TENANT_OWNER_ALREADY_BOOTSTRAPPED` (marker, existing membership, or repeat call) |
| 409 | `TENANT_NOT_BOOTSTRAPPABLE` (e.g. SUSPENDED, ARCHIVED, PROVISIONING registry tenant) |
| 400 | Body attempted to override tenant/user/role |

## Audit

- `tenant.owner_bootstrap_started`
- `tenant.owner_bootstrap_succeeded` | `tenant.owner_bootstrap_failed` | `tenant.owner_bootstrap_denied`

Denied audits cover existing membership, ineligible tenant, and repeat bootstrap — without exposing other members’ ids or roles.

## Rollback / recovery

- Do not hand-insert production membership rows except break-glass.
- Marker + membership are created atomically; do not delete one without the other.

After successful bootstrap the endpoint returns **409** for that tenant permanently.
