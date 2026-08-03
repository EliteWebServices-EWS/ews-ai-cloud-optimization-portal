# Tenant owner bootstrap validation

## Automated tests

- `tests/unit/membership/membership-bootstrap-repository.test.ts` — Query before TransactWrite, legacy `MEMBER#` without marker, no Scan
- `tests/unit/membership/membership-bootstrap-service.test.ts` — legacy membership → 409
- `tests/integration/tenant-owner-bootstrap-http.test.ts` — registry ACTIVE requirement, legacy statuses, deleted/missing tenant, concurrency, audit denied

## Quality gates

```bash
cd backend
npm test
npm run build
sam validate --lint
rm -rf .aws-sam   # Windows: Remove-Item -Recurse -Force .aws-sam
sam build --no-cached
cd ..
git diff --check
```

## Manual checklist

1. Active tenant registry row for trusted `tenant_id`.
2. Empty `MEMBER#` partition (or expect 409).
3. Platform admin + MFA → **201** once, **409** on repeat.
4. CloudWatch: `tenant.owner_bootstrap_*` without token material.

## Tenant lifecycle

| Registry status | Bootstrap |
|-----------------|-----------|
| ACTIVE | Allowed (if no memberships) |
| PROVISIONING, SUSPENDED, ARCHIVED | **409** `TENANT_NOT_BOOTSTRAPPABLE` |
| DELETED / missing | **404** |
